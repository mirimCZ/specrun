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
  diffStat(from: string, to: string): Promise<DiffStat>;
  changedFiles(from: string): Promise<string[]>;
  parkChanges(ref: string, message: string): Promise<string | null>;
  updateRef(ref: string, sha: string): Promise<void>;
  worktreeList(): Promise<WorktreeEntry[]>;
  /** Fails when the worktree has changes. */
  removeWorktree(path: string): Promise<void>;
  /** Fails when the branch is not merged. */
  deleteBranch(name: string): Promise<void>;
  /** Merges `branch` into the checked-out one; on failure aborts it and returns git's message. */
  merge(
    branch: string,
    mode: 'ff-only' | 'merge',
  ): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Commits reachable from `to` but not from `from`. */
  countCommits(from: string, to: string): Promise<number>;
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
      await git(['worktree', 'remove', path]);
    },

    async deleteBranch(name) {
      await git(['branch', '-q', '-d', name]);
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
  };
  return api;
}
