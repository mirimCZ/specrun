import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SpecrunError } from '../errors.js';
import { findRepoRoot, loadConfig } from './loadConfig.js';

const homedir = (): string => '/home/tester';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'specrun-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeConfig(value: unknown): void {
  writeFileSync(join(dir, 'specrun.config.json'), JSON.stringify(value));
}

function loadError(): SpecrunError {
  try {
    loadConfig(dir, { homedir });
  } catch (error) {
    if (error instanceof SpecrunError) return error;
    throw error;
  }
  throw new Error('loadConfig did not throw');
}

describe('loadConfig', () => {
  it('loads a minimal config and expands ~/ in transcriptsDir', () => {
    writeConfig({ verify: [{ name: 'test', command: 'npm test' }] });
    const config = loadConfig(dir, { homedir });
    expect(config.specsDir).toBe('docs');
    expect(config.transcriptsDir).toBe('/home/tester/.specrun/runs');
  });

  it('leaves an absolute transcriptsDir alone', () => {
    writeConfig({ verify: [{ name: 'test', command: 'npm test' }], transcriptsDir: '/var/runs' });
    expect(loadConfig(dir, { homedir }).transcriptsDir).toBe('/var/runs');
  });

  it('fails with config-missing when the file is absent', () => {
    expect(loadError().code).toBe('config-missing');
  });

  it('fails with config-invalid on broken JSON', () => {
    writeFileSync(join(dir, 'specrun.config.json'), '{ verify: ');
    expect(loadError().code).toBe('config-invalid');
  });

  it('lists one detail per issue with its path', () => {
    writeConfig({ verify: [], maxTurns: 0, extra: 1, sizes: { S: { turns: [9, 3], usd: 1 } } });
    const error = loadError();
    expect(error.code).toBe('config-invalid');
    expect(error.details).toHaveLength(4);
    expect(error.details).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^verify: /),
        expect.stringMatching(/^maxTurns: /),
        expect.stringMatching(/^\(root\): .*extra/),
        expect.stringMatching(/^sizes\.S\.turns: /),
      ]),
    );
    expect(error.message).toContain('maxTurns: ');
  });
});

describe('findRepoRoot', () => {
  it('walks up from a nested directory to the .git folder', () => {
    mkdirSync(join(dir, '.git'));
    const nested = join(dir, 'src', 'deep');
    mkdirSync(nested, { recursive: true });
    expect(findRepoRoot(nested)).toBe(dir);
  });

  it('accepts a .git file as in a worktree', () => {
    const worktree = join(dir, 'wt');
    mkdirSync(join(worktree, 'sub'), { recursive: true });
    writeFileSync(join(worktree, '.git'), 'gitdir: /elsewhere/.git/worktrees/wt\n');
    expect(findRepoRoot(join(worktree, 'sub'))).toBe(worktree);
  });
});
