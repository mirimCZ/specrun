import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eventLine, makeTempRepo, writeDemoSpec } from '../../test/fixtures/specRepo.js';
import { doneTask } from '../../test/fixtures/taskEvents.js';
import { ConfigSchema } from '../config/configSchema.js';
import { runCommand, type ProcessRunner } from '../process/run.js';
import { closeAll } from './closeAll.js';
import { closeSpec } from './closeSpec.js';

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};
const run: ProcessRunner = (cmd, args, opts) => runCommand(cmd, args, { ...opts, env });
const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();

const sharedRun = eventLine({
  t: 'run.started',
  spec: 'demo',
  branch: 'specrun/all',
  base: 'HEAD',
  version: '0.0.0',
  options: { workspace: 'shared' },
});

let repo: string;
let shared: string;

beforeEach(() => {
  repo = makeTempRepo();
  rmSync(join(repo, '.git'), { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  writeDemoSpec(repo);
  writeFileSync(join(repo, '.gitignore'), '.specrun/\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'spec');
  shared = join(repo, '.specrun', 'worktrees', '.all');
  git(repo, 'worktree', 'add', '-q', '-b', 'specrun/all', shared);
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

function ranShared(events: string): void {
  writeFileSync(join(shared, 'specrun', 'specs', 'demo', 'events.jsonl'), sharedRun + events);
  writeFileSync(join(shared, 'feature.txt'), 'feature\n');
  git(shared, 'add', '-A');
  git(shared, 'commit', '-q', '-m', 'feat: demo (D-1)');
}

const deps = {
  config: ConfigSchema.parse({ verify: [{ name: 'ok', command: 'true' }] }),
  run,
  now: () => new Date('2026-11-13T10:00:00.000Z'),
  isAlive: () => false,
};

describe('closeAll', () => {
  it('merges the shared branch, archives its specs, removes the worktree and branch', async () => {
    ranShared(doneTask('D-1', 5, 0.1) + doneTask('D-2', 5, 0.1));
    const result = await closeAll({ force: false }, { ...deps, repoRoot: repo });

    expect(result).toMatchObject({
      branch: 'specrun/all',
      into: 'main',
      merge: 'fast-forward',
      removedWorktree: '.specrun/worktrees/.all',
    });
    expect(result.archived.map((a) => a.spec)).toEqual(['demo']);
    expect(existsSync(join(repo, 'specrun', 'specs', 'archive', 'demo', 'README.md'))).toBe(true);
    expect(existsSync(join(repo, 'feature.txt'))).toBe(true);
    expect(existsSync(shared)).toBe(false);
    expect(git(repo, 'branch', '--list')).not.toContain('specrun/all');
  });

  it('refuses unfinished specs before merging', async () => {
    ranShared(doneTask('D-1', 5, 0.1));
    await expect(closeAll({ force: false }, { ...deps, repoRoot: repo })).rejects.toMatchObject({
      code: 'spec-invalid',
      details: ['demo: D-2 (todo)', expect.stringContaining('--force')],
    });
    expect(existsSync(join(repo, 'feature.txt'))).toBe(false);
  });

  it('refuses when no spec ran on the shared branch', async () => {
    await expect(closeAll({ force: false }, { ...deps, repoRoot: repo })).rejects.toMatchObject({
      code: 'spec-missing',
    });
  });
});

describe('closeSpec on a spec of run --all', () => {
  it('refuses with a hint to close them together', async () => {
    ranShared(doneTask('D-1', 5, 0.1) + doneTask('D-2', 5, 0.1));
    await expect(
      closeSpec({ spec: 'demo', force: false }, { ...deps, repoRoot: repo }),
    ).rejects.toMatchObject({
      code: 'spec-invalid',
      details: ['close them together with specrun close --all'],
    });
  });
});
