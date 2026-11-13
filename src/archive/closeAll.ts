import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SpecrunError } from '../errors.js';
import { EVENTS_FILE, readEvents } from '../events/eventStore.js';
import { deriveState } from '../events/taskState.js';
import { createGit } from '../git/git.js';
import { ranShared, SHARED_BRANCH, SHARED_ID, sharedWorktreePath } from '../git/workspace.js';
import { lockFile, readLockPid } from '../runner/lock.js';
import { listSpecs, loadSpec } from '../spec/loadSpec.js';
import { archiveSpec, type ArchiveResult } from './archiveSpec.js';
import { mergeInto, type CloseDeps, type MergeResult } from './closeSpec.js';

export interface CloseAllOptions {
  /** Branch to merge into; default the main checkout's current one. */
  into?: string;
  /** Close although specs on the shared branch have unfinished tasks. */
  force: boolean;
}

export interface CloseAllResult extends MergeResult {
  /** Every spec that ran on the shared branch, alphabetically. */
  archived: { spec: string; archive: ArchiveResult }[];
  /** Relative to the repo root; null with `"worktree": false`. */
  removedWorktree: string | null;
}

/**
 * SRD-32: merges the shared branch of `run --all` once, verifies a real merge, archives every spec
 * that ran on it, then removes the shared worktree and branch. All checks come before the merge.
 */
export async function closeAll(options: CloseAllOptions, deps: CloseDeps): Promise<CloseAllResult> {
  const { repoRoot, config } = deps;
  const git = createGit(repoRoot, deps.run);

  for (const name of [SHARED_ID, ...listSpecs(repoRoot, config)]) {
    const pid = readLockPid(lockFile(repoRoot, name));
    if (pid !== null && deps.isAlive(pid)) {
      throw new SpecrunError('locked', `A run holds the lock of "${name}" (pid ${pid})`, [
        'let it finish or stop it before closing',
      ]);
    }
  }
  if (!(await git.branchExists(SHARED_BRANCH))) {
    throw new SpecrunError('git-failed', `Branch ${SHARED_BRANCH} does not exist`, [
      'nothing to close — specrun run --all creates it',
    ]);
  }

  const worktree = sharedWorktreePath(repoRoot);
  const root = existsSync(worktree) ? worktree : repoRoot;
  const members = listSpecs(root, config).filter((name) => ranShared(root, config, name));
  if (members.length === 0) {
    throw new SpecrunError('spec-missing', `No spec ran on ${SHARED_BRANCH}`, [
      root === repoRoot
        ? `with "worktree": false, switch the checkout to ${SHARED_BRANCH} first`
        : 'nothing to close',
    ]);
  }

  if (!options.force) {
    const open = members.flatMap((name) => {
      const loaded = loadSpec(root, config, name);
      const state = deriveState(loaded.spec, readEvents(join(loaded.dir, EVENTS_FILE)).events);
      return loaded.spec.tasks
        .map((task) => ({ id: task.id, status: state.tasks.get(task.id)?.status ?? 'todo' }))
        .filter((task) => task.status !== 'done')
        .map((task) => `${name}: ${task.id} (${task.status})`);
    });
    if (open.length > 0) {
      throw new SpecrunError('spec-invalid', `Specs on ${SHARED_BRANCH} have unfinished tasks`, [
        ...open,
        'finish them (specrun run --all), or close with --force',
      ]);
    }
  }
  if (root === worktree && !(await createGit(worktree, deps.run).isClean())) {
    throw new SpecrunError('git-failed', `Worktree ${worktree} has uncommitted changes`, [
      'commit or discard them first — only committed work is merged',
    ]);
  }
  if (!(await git.isClean())) {
    throw new SpecrunError('checkout-dirty', `The main checkout ${repoRoot} has changes`, [
      'commit or stash them before merging',
    ]);
  }

  const merged = await mergeInto(SHARED_BRANCH, options.into, 'specrun close --all', 'all', deps);

  const archived: CloseAllResult['archived'] = [];
  for (const spec of members) {
    deps.onProgress?.({ step: 'archive', spec });
    archived.push({ spec, archive: await archiveSpec({ spec, force: options.force }, deps) });
  }
  let removedWorktree: string | null = null;
  if (root === worktree) {
    await git.removeWorktree(worktree);
    removedWorktree = relative(repoRoot, worktree);
  }
  if (await git.branchExists(SHARED_BRANCH)) await git.deleteBranch(SHARED_BRANCH);
  return { ...merged, archived, removedWorktree };
}
