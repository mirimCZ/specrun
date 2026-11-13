import { join } from 'node:path';
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
  /** Called before the slow steps of creating a worktree; nothing is reported for an existing one. */
  onProgress?: (step: WorktreeStep) => void;
  run: ProcessRunner;
}

export interface WorktreeInfo {
  path: string;
  created: boolean;
}

export type WorktreeStep = { step: 'add'; path: string } | { step: 'setup'; command: string };

export function worktreePath(repoRoot: string, spec: string): string {
  return join(repoRoot, '.specrun', 'worktrees', spec);
}

export async function ensureWorktree(input: EnsureWorktreeInput): Promise<WorktreeInfo> {
  const { repoRoot, spec, branch, base, setup, run, onProgress } = input;
  if (PROTECTED_BRANCHES.includes(branch)) {
    throw new SpecrunError('branch-protected', `Refusing to use protected branch '${branch}'.`);
  }
  const check = await run('git', ['check-ref-format', '--branch', branch], { cwd: repoRoot });
  if (check.code !== 0) {
    throw new SpecrunError('git-failed', `Invalid branch name '${branch}'.`);
  }

  const git = createGit(repoRoot, run);
  const existing = (await git.worktreeList()).find((entry) => entry.branch === branch);
  if (existing) {
    return { path: existing.path, created: false };
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
  return { path, created: true };
}
