import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCommand } from '../process/run.js';
import { createGit, type Git } from './git.js';

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};
const sh = (dir: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd: dir, env, encoding: 'utf8' });

let dir: string;
let git: Git;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'specrun-'));
  sh(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'a.txt'), 'one\n');
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', 'init');
  git = createGit(dir, (cmd, args, opts) => runCommand(cmd, args, { ...opts, env }));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('createGit', () => {
  it('commits with trailers and returns the new sha', async () => {
    writeFileSync(join(dir, 'b.txt'), 'two\n');
    await git.addAll();
    const sha = await git.commit({
      subject: 'feat: b (SR-3)',
      body: 'Added b.',
      trailers: ['Specrun-Task: SR-3', 'Specrun-Session: s1'],
    });
    expect(sha).toBe(sh(dir, 'rev-parse', 'HEAD').trim());
    expect(sh(dir, 'log', '-1', '--format=%B')).toBe(
      'feat: b (SR-3)\n\nAdded b.\n\nSpecrun-Task: SR-3\nSpecrun-Session: s1\n\n',
    );
    expect(await git.head()).toBe(sha);
  });

  it('reports cleanliness', async () => {
    expect(await git.isClean()).toBe(true);
    writeFileSync(join(dir, 'c.txt'), 'x');
    expect(await git.isClean()).toBe(false);
  });

  it('limits cleanliness to paths', async () => {
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'docs', 'new.md'), 'x');
    expect(await git.isClean(['a.txt'])).toBe(true);
    expect(await git.isClean(['docs'])).toBe(false);
  });

  it('tells whether a branch is merged', async () => {
    sh(dir, 'branch', 'merged');
    sh(dir, 'checkout', '-q', '-b', 'ahead');
    writeFileSync(join(dir, 'b.txt'), 'two\n');
    sh(dir, 'add', '-A');
    sh(dir, 'commit', '-q', '-m', 'ahead');
    sh(dir, 'checkout', '-q', 'main');
    expect(await git.isAncestor('merged', 'HEAD')).toBe(true);
    expect(await git.isAncestor('ahead', 'HEAD')).toBe(false);
    await expect(git.isAncestor('nope', 'HEAD')).rejects.toMatchObject({ code: 'git-failed' });
  });

  it('removes a clean worktree and its merged branch', async () => {
    const path = join(dir, 'wt');
    sh(dir, 'worktree', 'add', '-q', '-b', 'spec', path);
    await git.removeWorktree(path);
    await git.deleteBranch('spec');
    expect(await git.worktreeList()).toHaveLength(1);
    expect(await git.branchExists('spec')).toBe(false);
  });

  it('knows existing branches', async () => {
    expect(await git.branchExists('main')).toBe(true);
    expect(await git.branchExists('nope')).toBe(false);
  });

  it('lists changed files including untracked ones, and diff stats', async () => {
    const base = await git.head();
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n');
    writeFileSync(join(dir, 'new.txt'), 'n');
    expect(await git.changedFiles(base)).toEqual(['a.txt', 'new.txt']);
    await git.addAll();
    const sha = await git.commit({ subject: 's', body: '', trailers: [] });
    expect(await git.diffStat(base, sha)).toEqual({ filesChanged: 2, insertions: 2, deletions: 0 });
  });

  it('resetSoft keeps the changes staged', async () => {
    const base = await git.head();
    writeFileSync(join(dir, 'b.txt'), 'two\n');
    await git.addAll();
    await git.commit({ subject: 's', body: '', trailers: [] });
    await git.resetSoft(base);
    expect(await git.head()).toBe(base);
    expect(sh(dir, 'status', '--porcelain').trim()).toBe('A  b.txt');
  });

  it('parks tracked and untracked changes in a ref and cleans the worktree', async () => {
    const base = await git.head();
    writeFileSync(join(dir, 'a.txt'), 'changed\n');
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'u.txt'), 'untracked\n');
    const ref = 'refs/specrun/parked/demo/SR-3';
    const sha = await git.parkChanges(ref, 'park SR-3');
    expect(sha).toBe(sh(dir, 'rev-parse', ref).trim());
    expect(await git.isClean()).toBe(true);
    expect(await git.head()).toBe(base);
    expect(sh(dir, 'show', `${ref}:a.txt`)).toBe('changed\n');
    expect(sh(dir, 'show', `${ref}:sub/u.txt`)).toBe('untracked\n');
    expect(sh(dir, 'rev-parse', `${ref}^`).trim()).toBe(base);
  });

  it('commits only the given paths and leaves other changes in place', async () => {
    writeFileSync(join(dir, 'a.txt'), 'changed\n');
    sh(dir, 'add', 'a.txt');
    writeFileSync(join(dir, 'log.txt'), 'new\n');
    const message = { subject: 'chore: log', body: '', trailers: [] };
    const sha = await git.commitPaths(message, ['log.txt']);
    expect(sha).toBe(await git.head());
    expect(sh(dir, 'show', '--name-only', '--format=', 'HEAD').trim()).toBe('log.txt');
    expect(sh(dir, 'status', '--porcelain').trim()).toBe('M  a.txt');
    expect(await git.commitPaths(message, ['log.txt'])).toBeNull();
  });

  it('parkChanges returns null when clean', async () => {
    expect(await git.parkChanges('refs/specrun/parked/demo/SR-3', 'm')).toBeNull();
  });

  it('lists worktrees with branches', async () => {
    const list = await git.worktreeList();
    expect(list).toHaveLength(1);
    expect(list[0]?.branch).toBe('main');
  });

  it('throws git-failed with stderr', async () => {
    await expect(git.resetSoft('deadbeef')).rejects.toMatchObject({ code: 'git-failed' });
  });
});
