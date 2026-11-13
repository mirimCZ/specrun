import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SpecrunError } from '../errors.js';
import { runShell, type ProcessRunner } from '../process/run.js';
import { createGit } from './git.js';

export const PROTECTED_BRANCHES: readonly string[] = ['main', 'master'];

export interface EnsureWorktreeInput {
  repoRoot: string;
  spec: string;
  branch: string;
  /** Ref the branch is created from when it doesn't exist yet. */
  base: string;
  setup: string | null;
  /** Paths relative to the repo root, copied into a new worktree before `setup`; missing ones are skipped. */
  copyFiles?: readonly string[];
  /** Called before the slow steps of creating a worktree; nothing is reported for an existing one. */
  onProgress?: (step: WorktreeStep) => void;
  run: ProcessRunner;
}

export interface WorktreeInfo {
  path: string;
  created: boolean;
  /** `copyFiles` entries that were copied. */
  copied: string[];
}

export type WorktreeStep =
  | { step: 'add'; path: string }
  | { step: 'setup'; command: string }
  | { step: 'switch'; branch: string };

export function worktreePath(repoRoot: string, spec: string): string {
  return join(repoRoot, '.specrun', 'worktrees', spec);
}

async function checkBranchName(
  branch: string,
  repoRoot: string,
  run: ProcessRunner,
): Promise<void> {
  if (PROTECTED_BRANCHES.includes(branch)) {
    throw new SpecrunError('branch-protected', `Refusing to use protected branch '${branch}'.`);
  }
  const check = await run('git', ['check-ref-format', '--branch', branch], { cwd: repoRoot });
  if (check.code !== 0) {
    throw new SpecrunError('git-failed', `Invalid branch name '${branch}'.`);
  }
}

function copyInto(repoRoot: string, target: string, files: readonly string[]): string[] {
  const copied: string[] = [];
  for (const file of files) {
    const source = join(repoRoot, file);
    if (!existsSync(source)) continue;
    mkdirSync(dirname(join(target, file)), { recursive: true });
    copyFileSync(source, join(target, file));
    copied.push(file);
  }
  return copied;
}

export async function ensureWorktree(input: EnsureWorktreeInput): Promise<WorktreeInfo> {
  const { repoRoot, spec, branch, base, setup, run, onProgress } = input;
  await checkBranchName(branch, repoRoot, run);

  const git = createGit(repoRoot, run);
  const existing = (await git.worktreeList()).find((entry) => entry.branch === branch);
  if (existing?.path === repoRoot) {
    // Left there by an earlier `"worktree": false` run; git allows a branch in one place only.
    throw new SpecrunError('worktree-exists', `The main checkout is on ${branch}`, [
      'switch it to another branch, or set "worktree": false to keep running there',
    ]);
  }
  if (existing) {
    return { path: existing.path, created: false, copied: [] };
  }

  const path = worktreePath(repoRoot, spec);
  onProgress?.({ step: 'add', path });
  const args = (await git.branchExists(branch))
    ? ['worktree', 'add', path, branch]
    : ['worktree', 'add', '-b', branch, path, base];
  const added = await run('git', args, { cwd: repoRoot });
  if (added.code !== 0) {
    throw new SpecrunError('git-failed', `git ${args.join(' ')} failed`, [
      added.stderr.trim() || `exit code ${added.code}`,
    ]);
  }
  // Before setup: install scripts or generators may read e.g. `.env`.
  const copied = copyInto(repoRoot, path, input.copyFiles ?? []);

  if (setup) {
    onProgress?.({ step: 'setup', command: setup });
    const result = await runShell(setup, { cwd: path }, run);
    if (result.code !== 0) {
      const tail = (result.stderr || result.stdout).trim().split('\n').slice(-20);
      throw new SpecrunError('setup-failed', `Setup command failed in ${path} (worktree kept)`, [
        `command: ${setup}`,
        ...tail,
      ]);
    }
  }
  return { path, created: true, copied };
}

export type EnsureCheckoutInput = Pick<
  EnsureWorktreeInput,
  'repoRoot' | 'spec' | 'branch' | 'base' | 'onProgress' | 'run'
>;

/**
 * `worktree: false`: the main checkout itself on the spec branch. Switching needs a clean tree —
 * the runner resets and cleans it when parking — but staying on the branch does not, so an
 * interrupted run's work is resumed like in a worktree.
 */
export async function ensureCheckout(input: EnsureCheckoutInput): Promise<WorktreeInfo> {
  const { repoRoot, spec, branch, base, run, onProgress } = input;
  await checkBranchName(branch, repoRoot, run);
  const git = createGit(repoRoot, run);

  // Two copies of the spec's log would drift apart; `status` would read the worktree's.
  const other = (await git.worktreeList()).find(
    (entry) => entry.branch === branch && entry.path !== repoRoot,
  );
  if (other !== undefined || existsSync(worktreePath(repoRoot, spec))) {
    throw new SpecrunError('worktree-exists', `${spec} already runs in a worktree`, [
      `finish it there, or remove ${other?.path ?? worktreePath(repoRoot, spec)} first`,
    ]);
  }

  if ((await git.currentBranch()) === branch) return { path: repoRoot, created: false, copied: [] };
  if (!(await git.isClean())) {
    throw new SpecrunError('checkout-dirty', `Cannot switch the checkout to ${branch}`, [
      'commit or stash your changes first — with "worktree": false the run resets and cleans it',
    ]);
  }
  onProgress?.({ step: 'switch', branch });
  await git.switchBranch(branch, base);
  return { path: repoRoot, created: false, copied: [] };
}
