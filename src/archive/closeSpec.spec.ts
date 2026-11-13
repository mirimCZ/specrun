import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTempRepo, writeDemoSpec } from '../../test/fixtures/specRepo.js';
import { doneTask } from '../../test/fixtures/taskEvents.js';
import { ConfigSchema, type Config } from '../config/configSchema.js';
import { runCommand, type ProcessRunner } from '../process/run.js';
import { closeSpec, type CloseOptions, type CloseResult, type CloseStep } from './closeSpec.js';

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

let repo: string;
let worktree: string;

beforeEach(() => {
  repo = makeTempRepo();
  rmSync(join(repo, '.git'), { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  writeDemoSpec(repo);
  writeFileSync(join(repo, '.gitignore'), '.specrun/\n');
  writeFileSync(join(repo, 'shared.txt'), 'base\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'spec');
  worktree = join(repo, '.specrun', 'worktrees', 'demo');
  git(repo, 'worktree', 'add', '-q', '-b', 'specrun/demo', worktree);
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

/** Both tasks done on the spec branch, plus a code change in `file`. */
function finishTasks(
  cwd: string,
  events = doneTask('D-1', 5, 0.1) + doneTask('D-2', 5, 0.1),
): void {
  writeFileSync(join(cwd, 'docs', 'demo', 'events.jsonl'), events);
  writeFileSync(join(cwd, 'feature.txt'), 'feature\n');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', 'feat: demo (D-1)');
}

async function close(
  options: Partial<CloseOptions> = {},
  config: Config = ConfigSchema.parse({ verify: [{ name: 'ok', command: 'true' }] }),
): Promise<{ result: CloseResult; steps: CloseStep[] }> {
  const steps: CloseStep[] = [];
  const result = await closeSpec(
    { spec: 'demo', force: false, ...options },
    {
      repoRoot: repo,
      config,
      run,
      now: () => new Date('2026-11-13T10:00:00.000Z'),
      isAlive: () => false,
      onProgress: (step) => void steps.push(step),
    },
  );
  return { result, steps };
}

const archived = (): boolean => existsSync(join(repo, 'docs', 'archive', 'demo', 'README.md'));
const branches = (): string => git(repo, 'branch', '--list');

describe('closeSpec', () => {
  it('fast-forwards, skips verify and archives, removing the worktree and branch', async () => {
    finishTasks(worktree);
    const { result, steps } = await close();

    expect(result).toMatchObject({ into: 'main', merge: 'fast-forward', commits: 1, verify: null });
    expect(result.archive.removed).toEqual({
      worktree: '.specrun/worktrees/demo',
      branch: 'specrun/demo',
    });
    expect(steps.map((s) => s.step)).toEqual(['merge', 'archive']);
    expect(archived()).toBe(true);
    expect(existsSync(join(repo, 'feature.txt'))).toBe(true);
    expect(existsSync(worktree)).toBe(false);
    expect(branches()).not.toContain('specrun/demo');
  });

  it('verifies a real merge before archiving', async () => {
    finishTasks(worktree);
    writeFileSync(join(repo, 'other.txt'), 'meanwhile\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'meanwhile');

    const { result, steps } = await close();
    expect(result.merge).toBe('merge-commit');
    expect(result.verify?.ok).toBe(true);
    expect(steps.map((s) => s.step)).toEqual(['merge', 'verify', 'verify-step', 'archive']);
    expect(git(repo, 'log', '-1', '--format=%P', 'HEAD~1').split(' ')).toHaveLength(2);
  });

  it('keeps the merge but does not archive when verify is red', async () => {
    finishTasks(worktree);
    writeFileSync(join(repo, 'other.txt'), 'meanwhile\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'meanwhile');

    await expect(
      close({}, ConfigSchema.parse({ verify: [{ name: 'check', command: 'exit 1' }] })),
    ).rejects.toThrow('Verify failed after merging specrun/demo into main');
    expect(git(repo, 'merge-base', '--is-ancestor', 'specrun/demo', 'HEAD')).toBe('');
    expect(archived()).toBe(false);
  });

  it('refuses unfinished tasks and a dirty checkout before merging', async () => {
    finishTasks(worktree, doneTask('D-1', 5, 0.1));
    const head = git(repo, 'rev-parse', 'HEAD');
    await expect(close()).rejects.toThrow('has unfinished tasks');

    finishTasks(worktree);
    writeFileSync(join(repo, 'shared.txt'), 'edited\n');
    await expect(close()).rejects.toThrow('has changes');
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(head);
  });

  it('aborts a conflicting merge and leaves the checkout as it was', async () => {
    writeFileSync(join(worktree, 'shared.txt'), 'branch\n');
    finishTasks(worktree);
    writeFileSync(join(repo, 'shared.txt'), 'main\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'conflict');

    await expect(close()).rejects.toThrow('Merging specrun/demo into main failed (aborted)');
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(archived()).toBe(false);
  });

  it('switches a checkout left on the spec branch back to main and deletes the branch', async () => {
    git(repo, 'worktree', 'remove', worktree);
    git(repo, 'switch', '-q', 'specrun/demo');
    finishTasks(repo);

    const { result } = await close();
    expect(result).toMatchObject({
      into: 'main',
      merge: 'fast-forward',
      deletedBranch: 'specrun/demo',
    });
    expect(git(repo, 'branch', '--show-current')).toBe('main');
    expect(branches()).not.toContain('specrun/demo');
    expect(archived()).toBe(true);
  });
});
