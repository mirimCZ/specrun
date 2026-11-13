import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCommand, type ProcessRunner } from '../process/run.js';
import { ensureCheckout, ensureWorktree } from './worktree.js';

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};
const run: ProcessRunner = (cmd, args, opts) => runCommand(cmd, args, { ...opts, env });

let repo: string;
const input = (over: Partial<Parameters<typeof ensureWorktree>[0]> = {}) => ({
  repoRoot: repo,
  spec: 'demo',
  branch: 'specrun/demo',
  base: 'HEAD',
  setup: null,
  run,
  ...over,
});

const git = (...args: string[]): string => execFileSync('git', args, { cwd: repo, env }).toString();

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'specrun-')));
  git('init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'a.txt'), 'one\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('ensureWorktree', () => {
  it('creates the branch and worktree from base, then reuses it', async () => {
    const first = await ensureWorktree(input());
    expect(first).toEqual({
      path: join(repo, '.specrun', 'worktrees', 'demo'),
      created: true,
      copied: [],
    });
    expect(readFileSync(join(first.path, 'a.txt'), 'utf8')).toBe('one\n');
    const branch = execFileSync('git', ['branch', '--show-current'], { cwd: first.path, env });
    expect(branch.toString().trim()).toBe('specrun/demo');

    const second = await ensureWorktree(input());
    expect(second).toEqual({ path: first.path, created: false, copied: [] });
  });

  it('uses an existing branch without a base', async () => {
    execFileSync('git', ['branch', 'specrun/demo'], { cwd: repo, env });
    const result = await ensureWorktree(input({ base: 'does-not-exist' }));
    expect(result.created).toBe(true);
  });

  it('runs setup once, in the worktree', async () => {
    const setup = 'echo x >> setup.log';
    const { path } = await ensureWorktree(input({ setup }));
    await ensureWorktree(input({ setup }));
    expect(readFileSync(join(path, 'setup.log'), 'utf8')).toBe('x\n');
  });

  it('keeps the worktree when setup fails', async () => {
    await expect(ensureWorktree(input({ setup: 'echo boom >&2; exit 3' }))).rejects.toMatchObject({
      code: 'setup-failed',
    });
    expect(existsSync(join(repo, '.specrun', 'worktrees', 'demo'))).toBe(true);
  });

  it('refuses protected branches', async () => {
    await expect(ensureWorktree(input({ branch: 'main' }))).rejects.toMatchObject({
      code: 'branch-protected',
    });
    await expect(ensureWorktree(input({ branch: 'master' }))).rejects.toMatchObject({
      code: 'branch-protected',
    });
  });

  it('copies ignored files into a new worktree before setup and skips missing ones', async () => {
    writeFileSync(join(repo, '.env'), 'KEY=1\n');
    const { path, copied } = await ensureWorktree(
      input({ copyFiles: ['.env', 'apps/x/.env.local'], setup: 'cat .env > seen.txt' }),
    );
    expect(copied).toEqual(['.env']);
    expect(readFileSync(join(path, 'seen.txt'), 'utf8')).toBe('KEY=1\n');
  });

  it('refuses when the main checkout itself is on the spec branch', async () => {
    git('switch', '-q', '-c', 'specrun/demo');
    await expect(ensureWorktree(input())).rejects.toMatchObject({ code: 'worktree-exists' });
  });
});

describe('ensureCheckout', () => {
  const current = (): string => git('branch', '--show-current').trim();

  it('switches a clean checkout to the spec branch, creating it from base', async () => {
    const result = await ensureCheckout(input());
    expect(result).toEqual({ path: repo, created: false, copied: [] });
    expect(current()).toBe('specrun/demo');
  });

  it('refuses to switch a dirty checkout but resumes on the spec branch with changes', async () => {
    writeFileSync(join(repo, 'b.txt'), 'mine\n');
    await expect(ensureCheckout(input())).rejects.toMatchObject({ code: 'checkout-dirty' });
    expect(current()).toBe('main');

    git('stash', '-q', '--include-untracked');
    await ensureCheckout(input());
    writeFileSync(join(repo, 'a.txt'), 'agent work\n');
    await expect(ensureCheckout(input())).resolves.toMatchObject({ path: repo });
  });

  it('refuses while the spec has a worktree', async () => {
    await ensureWorktree(input());
    await expect(ensureCheckout(input())).rejects.toMatchObject({ code: 'worktree-exists' });
  });
});
