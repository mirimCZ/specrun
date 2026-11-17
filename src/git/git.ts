import { existsSync, realpathSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { SpecrunError } from '../errors.js';
import type { ProcessRunner } from '../process/run.js';
import type { CommitMessageParts } from './commitMessage.js';

export interface DiffStat {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface WorktreeEntry {
  path: string;
  head: string;
  /** Short branch name; null when detached. */
  branch: string | null;
}

export interface Git {
  head(): Promise<string>;
  /** Commit sha of `ref`; throws when it names no commit. */
  resolve(ref: string): Promise<string>;
  /** Tracked and untracked changes; limited to `paths` when given. */
  isClean(paths?: readonly string[]): Promise<boolean>;
  branchExists(name: string): Promise<boolean>;
  /** Short name of the checked-out branch; null when detached. */
  currentBranch(): Promise<string | null>;
  /** `git switch`, creating the branch from `base` when it doesn't exist. */
  switchBranch(name: string, base: string): Promise<void>;
  /** Whether `ref` is reachable from `of` (merged into it). */
  isAncestor(ref: string, of: string): Promise<boolean>;
  addAll(): Promise<void>;
  commit(message: CommitMessageParts): Promise<string>;
  /** Commits only `paths` (other staged or unstaged changes stay); null when they're unchanged. */
  commitPaths(message: CommitMessageParts, paths: readonly string[]): Promise<string | null>;
  resetSoft(sha: string): Promise<void>;
  resetHardClean(): Promise<void>;
  /** Moves the checked-out branch to `sha`, discarding changes. */
  resetHard(sha: string): Promise<void>;
  diffStat(from: string, to: string): Promise<DiffStat>;
  changedFiles(from: string): Promise<string[]>;
  parkChanges(ref: string, message: string): Promise<string | null>;
  updateRef(ref: string, sha: string): Promise<void>;
  worktreeList(): Promise<WorktreeEntry[]>;
  /** Fails when the worktree has changes; retries a folder that something keeps writing into. */
  removeWorktree(path: string): Promise<void>;
  /** Fails when the branch is not merged — `force` skips git's check (callers check themselves). */
  deleteBranch(name: string, force?: boolean): Promise<void>;
  /** Merges `branch` into the checked-out one; on failure aborts it and returns git's message. */
  merge(
    branch: string,
    mode: 'ff-only' | 'merge',
  ): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Commits reachable from `to` but not from `from`. */
  countCommits(from: string, to: string): Promise<number>;
  remoteExists(name: string): Promise<boolean>;
  /** `git push -u`, never forced: a remote branch that moved elsewhere makes it fail. */
  push(remote: string, branch: string): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Fetches the remote's `branch` into `refs/remotes/<remote>/<branch>`; returns its sha. */
  fetchBranch(
    remote: string,
    branch: string,
  ): Promise<{ ok: true; sha: string } | { ok: false; error: string }>;
  /** Content of `path` (relative to the repo root) at `ref`; null when it isn't there. */
  showFile(ref: string, path: string): Promise<string | null>;
  hasPath(ref: string, path: string): Promise<boolean>;
  /** `git checkout <ref> -- <paths>`: the working tree and index get the paths as at `ref`. */
  restorePaths(ref: string, paths: readonly string[]): Promise<void>;
  /**
   * Commits `content` as `path` on top of `branch` without checking it out (the branch must not be
   * checked out anywhere, its working tree would fall behind); returns the new sha.
   */
  commitFileOnBranch(
    branch: string,
    path: string,
    content: string,
    message: CommitMessageParts,
  ): Promise<string>;
}

export function createGit(cwd: string, run: ProcessRunner): Git {
  const git = async (args: string[], input?: string): Promise<string> => {
    const result = await run('git', args, { cwd, ...(input !== undefined ? { input } : {}) });
    if (result.code !== 0) {
      throw new SpecrunError('git-failed', `git ${args.join(' ')} failed`, [
        result.stderr.trim() || `exit code ${result.code}`,
      ]);
    }
    return result.stdout;
  };

  const lines = (text: string): string[] => text.split('\n').filter((line) => line !== '');

  const api: Git = {
    async head() {
      return (await git(['rev-parse', 'HEAD'])).trim();
    },

    async resolve(ref) {
      return (await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])).trim();
    },

    async isClean(paths) {
      const pathArgs = paths === undefined ? [] : ['--', ...paths];
      return (await git(['status', '--porcelain', ...pathArgs])).trim() === '';
    },

    async currentBranch() {
      const result = await run('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd });
      return result.code === 0 ? result.stdout.trim() : null;
    },

    async switchBranch(name, base) {
      await git(
        (await api.branchExists(name))
          ? ['switch', '--quiet', name]
          : ['switch', '--quiet', '-c', name, base],
      );
    },

    async branchExists(name) {
      const result = await run('git', ['show-ref', '--verify', '--quiet', `refs/heads/${name}`], {
        cwd,
      });
      return result.code === 0;
    },

    async isAncestor(ref, of) {
      const result = await run('git', ['merge-base', '--is-ancestor', ref, of], { cwd });
      if (result.code > 1) {
        throw new SpecrunError('git-failed', `git merge-base --is-ancestor ${ref} ${of} failed`, [
          result.stderr.trim() || `exit code ${result.code}`,
        ]);
      }
      return result.code === 0;
    },

    async addAll() {
      await git(['add', '-A']);
    },

    async commit({ subject, body, trailers }) {
      const sections = [subject, body, trailers.join('\n')].filter((s) => s !== '');
      await git(['commit', '-q', '--allow-empty', '-F', '-'], `${sections.join('\n\n')}\n`);
      return api.head();
    },

    async commitPaths({ subject, body, trailers }, paths) {
      if ((await git(['status', '--porcelain', '--', ...paths])).trim() === '') return null;
      // `add` first: `commit -- <path>` rejects files git doesn't know yet.
      await git(['add', '--', ...paths]);
      const sections = [subject, body, trailers.join('\n')].filter((s) => s !== '');
      await git(['commit', '-q', '-F', '-', '--', ...paths], `${sections.join('\n\n')}\n`);
      return api.head();
    },

    async resetSoft(sha) {
      await git(['reset', '--soft', sha]);
    },

    async resetHardClean() {
      await git(['reset', '--hard', '-q']);
      await git(['clean', '-fdq']);
    },

    async resetHard(sha) {
      await git(['reset', '--hard', '-q', sha]);
    },

    async diffStat(from, to) {
      const out = await git(['diff', '--numstat', from, to]);
      const stat: DiffStat = { filesChanged: 0, insertions: 0, deletions: 0 };
      for (const line of lines(out)) {
        const [added = '', removed = ''] = line.split('\t');
        stat.filesChanged += 1;
        // Binary files show `-`.
        stat.insertions += Number(added) || 0;
        stat.deletions += Number(removed) || 0;
      }
      return stat;
    },

    async changedFiles(from) {
      const tracked = lines(await git(['diff', '--name-only', from]));
      const untracked = lines(await git(['ls-files', '--others', '--exclude-standard']));
      return [...new Set([...tracked, ...untracked])].sort();
    },

    async parkChanges(ref, message) {
      if (await api.isClean()) return null;
      const head = await api.head();
      await git(['add', '-A']);
      const tree = (await git(['write-tree'])).trim();
      const sha = (await git(['commit-tree', tree, '-p', head, '-F', '-'], `${message}\n`)).trim();
      await git(['update-ref', ref, sha]);
      await api.resetHardClean();
      return sha;
    },

    async updateRef(ref, sha) {
      await git(['update-ref', ref, sha]);
    },

    async worktreeList() {
      const out = await git(['worktree', 'list', '--porcelain']);
      const entries: WorktreeEntry[] = [];
      let current: WorktreeEntry | null = null;
      for (const line of out.split('\n')) {
        if (line.startsWith('worktree ')) {
          current = { path: line.slice('worktree '.length), head: '', branch: null };
          entries.push(current);
        } else if (current && line.startsWith('HEAD ')) {
          current.head = line.slice('HEAD '.length);
        } else if (current && line.startsWith('branch ')) {
          current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
        }
      }
      return entries;
    },

    async removeWorktree(path) {
      const result = await run('git', ['worktree', 'remove', path], { cwd });
      if (result.code === 0) return;
      const failed = new SpecrunError('git-failed', `git worktree remove ${path} failed`, [
        result.stderr.trim() || `exit code ${result.code}`,
      ]);
      // git unregisters a clean worktree even when deleting its folder fails — a daemon the verify
      // steps started there (the Nx daemon) still writes into it — and won't try again.
      const real = existsSync(path) ? realpathSync(path) : null;
      const registered = (await api.worktreeList()).some(
        (e) => existsSync(e.path) && realpathSync(e.path) === real,
      );
      if (real === null || registered) throw failed;
      try {
        await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      } catch (error) {
        throw new SpecrunError('git-failed', `Could not delete the worktree folder ${path}`, [
          error instanceof Error ? error.message : String(error),
          'git no longer tracks it — stop what still runs there (e.g. `npx nx daemon --stop`) ' +
            'and delete the folder',
        ]);
      }
    },

    async deleteBranch(name, force = false) {
      await git(['branch', '-q', force ? '-D' : '-d', name]);
    },

    async merge(branch, mode) {
      const args = mode === 'ff-only' ? ['--ff-only'] : ['--no-edit'];
      const result = await run('git', ['merge', '-q', ...args, branch], { cwd });
      if (result.code === 0) return { ok: true };
      // A conflicted merge would leave the checkout half-merged; put it back as it was.
      await run('git', ['merge', '--abort'], { cwd });
      return {
        ok: false,
        error: (result.stdout + result.stderr).trim() || `exit code ${result.code}`,
      };
    },

    async countCommits(from, to) {
      return Number((await git(['rev-list', '--count', `${from}..${to}`])).trim());
    },

    async remoteExists(name) {
      return lines(await git(['remote'])).includes(name);
    },

    async push(remote, branch) {
      const result = await run('git', ['push', '-q', '-u', remote, branch], { cwd });
      if (result.code === 0) return { ok: true };
      return { ok: false, error: result.stderr.trim() || `exit code ${result.code}` };
    },

    async fetchBranch(remote, branch) {
      const tracking = `refs/remotes/${remote}/${branch}`;
      const result = await run(
        'git',
        ['fetch', '-q', remote, `+refs/heads/${branch}:${tracking}`],
        { cwd },
      );
      if (result.code !== 0) {
        return { ok: false, error: result.stderr.trim() || `exit code ${result.code}` };
      }
      return { ok: true, sha: await api.resolve(tracking) };
    },

    async showFile(ref, path) {
      if (!(await api.hasPath(ref, path))) return null;
      return git(['show', `${ref}:${path}`]);
    },

    async hasPath(ref, path) {
      const result = await run('git', ['cat-file', '-e', `${ref}:${path}`], { cwd });
      return result.code === 0;
    },

    async restorePaths(ref, paths) {
      await git(['checkout', '-q', ref, '--', ...paths]);
    },

    async commitFileOnBranch(branch, path, content, { subject, body, trailers }) {
      const parent = await api.resolve(`refs/heads/${branch}`);
      const blob = (await git(['hash-object', '-w', '--stdin'], content)).trim();
      // Rebuilds the trees along `path` with mktree; an index would need GIT_INDEX_FILE.
      const replace = async (tree: string | null, segments: string[]): Promise<string> => {
        const [name = '', ...rest] = segments;
        const entries =
          tree === null ? [] : (await git(['ls-tree', '-z', tree])).split('\0').filter(Boolean);
        const old = entries.find((entry) => entry.split('\t')[1] === name);
        const kept = entries.filter((entry) => entry !== old);
        const oldTree = old?.split(/\s/)[1] === 'tree' ? (old.split(/\s/)[2] ?? null) : null;
        const entry =
          rest.length === 0
            ? `100644 blob ${blob}\t${name}`
            : `040000 tree ${await replace(oldTree, rest)}\t${name}`;
        return (await git(['mktree', '-z'], [...kept, entry].map((e) => `${e}\0`).join(''))).trim();
      };
      const tree = await replace(`${parent}^{tree}`, path.split('/'));
      const sections = [subject, body, trailers.join('\n')].filter((s) => s !== '');
      const sha = (
        await git(['commit-tree', tree, '-p', parent, '-F', '-'], `${sections.join('\n\n')}\n`)
      ).trim();
      await git(['update-ref', `refs/heads/${branch}`, sha, parent]);
      return sha;
    },
  };
  return api;
}
