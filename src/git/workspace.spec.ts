import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eventLine, makeTempRepo, writeDemoSpec } from '../../test/fixtures/specRepo.js';
import { ConfigSchema } from '../config/configSchema.js';
import { runsShared, specWorkspace } from './workspace.js';

const config = ConfigSchema.parse({ verify: [{ name: 'ok', command: 'true' }] });
const started = (branch: string): string =>
  eventLine({ t: 'run.started', spec: 'demo', branch, base: 'HEAD', version: '0', options: {} });

let repo: string;
let shared: string;
beforeEach(() => {
  repo = makeTempRepo();
  writeDemoSpec(repo);
  shared = join(repo, '.specrun', 'worktrees', '.all');
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('specWorkspace', () => {
  it('is the main checkout without worktrees', () => {
    expect(specWorkspace(repo, config, 'demo')).toEqual({ kind: 'checkout', path: repo });
    expect(runsShared(repo, config, 'demo')).toBe(false);
  });

  it('is the shared worktree only once the spec ran there', () => {
    const copy = writeDemoSpec(shared);
    expect(specWorkspace(repo, config, 'demo').kind).toBe('checkout');
    writeFileSync(join(copy, 'events.jsonl'), started('specrun/all'));
    expect(specWorkspace(repo, config, 'demo')).toEqual({ kind: 'shared', path: shared });
    expect(runsShared(repo, config, 'demo')).toBe(true);
  });

  it('prefers the spec own worktree', () => {
    writeFileSync(join(writeDemoSpec(shared), 'events.jsonl'), started('specrun/all'));
    const own = join(repo, '.specrun', 'worktrees', 'demo');
    mkdirSync(own, { recursive: true });
    expect(specWorkspace(repo, config, 'demo')).toEqual({ kind: 'own', path: own });
  });

  it('follows the checked-out log with "worktree": false', () => {
    const inPlace = { ...config, worktree: false };
    writeFileSync(join(repo, 'specrun', 'specs', 'demo', 'events.jsonl'), started('specrun/all'));
    expect(runsShared(repo, inPlace, 'demo')).toBe(true);
    writeFileSync(join(repo, 'specrun', 'specs', 'demo', 'events.jsonl'), started('specrun/demo'));
    expect(runsShared(repo, inPlace, 'demo')).toBe(false);
  });
});
