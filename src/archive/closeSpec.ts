import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SpecrunError } from '../errors.js';
import { EVENTS_FILE, readEvents } from '../events/eventStore.js';
import { deriveState } from '../events/taskState.js';
import { createGit } from '../git/git.js';
import { runsShared, SHARED_BRANCH } from '../git/workspace.js';
import { PROTECTED_BRANCHES, worktreePath } from '../git/worktree.js';
import { lockFile, readLockPid } from '../runner/lock.js';
import { loadSpec } from '../spec/loadSpec.js';
import { runVerify, type VerifyResult, type VerifyStepResult } from '../verify/verify.js';
import { archiveSpec, type ArchiveDeps, type ArchiveResult } from './archiveSpec.js';
import { refuseShelved } from './history.js';

export interface CloseOptions {
  spec: string;
  /** Branch to merge into; default the main checkout's current one. */
  into?: string;
  /** Passed to archive: close although tasks are unfinished. */
  force: boolean;
}

export interface CloseDeps extends ArchiveDeps {
  /** Before the slow steps, so a terminal shows what runs. */
  onProgress?: (step: CloseStep) => void;
}

export type CloseStep =
  | { step: 'merge'; branch: string; into: string; commits: number; fastForward: boolean }
  | { step: 'verify'; steps: string[] }
  | { step: 'verify-step'; finished: VerifyStepResult }
  | { step: 'archive'; spec: string };

export interface MergeResult {
  branch: string;
  into: string;
  /** `already`: the branch was merged before (e.g. by hand), nothing to merge. */
  merge: 'already' | 'fast-forward' | 'merge-commit';
  commits: number;
  /** Null after a fast-forward or no merge: the tree is the one the last task verified. */
  verify: VerifyResult | null;
}

export interface CloseResult extends MergeResult {
  archive: ArchiveResult;
  /** The spec branch, when close deleted it (archive only removes it with a worktree). */
  deletedBranch: string | null;
}

/** `--into`, else the main checkout's branch, else (checkout on the spec branch) main / master. */
export async function targetBranch(
  into: string | undefined,
  current: string | null,
  branch: string,
  branchExists: (name: string) => Promise<boolean>,
): Promise<string> {
  if (into !== undefined) return into;
  // `"worktree": false` leaves the checkout on the spec branch; the base is main / master then.
  if (current !== null && current !== branch) return current;
  for (const name of PROTECTED_BRANCHES) if (await branchExists(name)) return name;
  throw new SpecrunError('git-failed', `No branch to merge ${branch} into`, [
    'name one with --into <branch>',
  ]);
}

/** Merges the spec branch into the main checkout's branch, verifies a real merge, archives. */
export async function closeSpec(options: CloseOptions, deps: CloseDeps): Promise<CloseResult> {
  const { repoRoot, config } = deps;
  const name = options.spec;
  const git = createGit(repoRoot, deps.run);

  refuseShelved(repoRoot, config, name);
  const pid = readLockPid(lockFile(repoRoot, name));
  if (pid !== null && deps.isAlive(pid)) {
    throw new SpecrunError('locked', `A run holds the lock of "${name}" (pid ${pid})`, [
      'let it finish or stop it before closing',
    ]);
  }
  // SRD-32: its branch holds the other specs' work too.
  if (runsShared(repoRoot, config, name)) {
    throw new SpecrunError('spec-invalid', `"${name}" runs on ${SHARED_BRANCH} with other specs`, [
      'close them together with specrun close --all',
    ]);
  }
  // The worktree has the live copy of the spec and its log (SRD-4).
  const worktree = worktreePath(repoRoot, name);
  const base = existsSync(worktree) ? worktree : repoRoot;
  const loaded = loadSpec(base, config, name);
  const branch = loaded.spec.branch ?? `specrun/${name}`;
  if (!(await git.branchExists(branch))) {
    throw new SpecrunError('git-failed', `Branch ${branch} does not exist`, [
      'nothing to merge — use specrun archive if the spec is already merged',
    ]);
  }

  // Checked before merging, so a refusal leaves nothing half done.
  if (!options.force) {
    const state = deriveState(loaded.spec, readEvents(join(loaded.dir, EVENTS_FILE)).events);
    const open = loaded.spec.tasks
      .map((task) => ({ id: task.id, status: state.tasks.get(task.id)?.status ?? 'todo' }))
      .filter((task) => task.status !== 'done')
      .map((task) => `${task.id} (${task.status})`);
    if (open.length > 0) {
      throw new SpecrunError('spec-invalid', `Spec "${name}" has unfinished tasks`, [
        ...open,
        'finish them (specrun run), or close with --force',
      ]);
    }
  }
  if (base === worktree && !(await createGit(worktree, deps.run).isClean())) {
    throw new SpecrunError('git-failed', `Worktree ${worktree} has uncommitted changes`, [
      'commit or discard them first — only committed work is merged',
    ]);
  }
  if (!(await git.isClean())) {
    throw new SpecrunError('checkout-dirty', `The main checkout ${repoRoot} has changes`, [
      'commit or stash them before merging',
    ]);
  }

  const merged = await mergeInto(branch, options.into, `specrun close ${name}`, name, deps);

  deps.onProgress?.({ step: 'archive', spec: name });
  const archive = await archiveSpec({ spec: name, force: options.force }, deps);
  let deletedBranch: string | null = null;
  if (archive.removed === null && (await git.branchExists(branch))) {
    // Merged just now; `-d` would also want a pushed branch (shelve) in its upstream.
    await git.deleteBranch(branch, true);
    deletedBranch = branch;
  }
  return { ...merged, archive, deletedBranch };
}

/**
 * Merges `branch` into the target (`into`, else the main checkout's branch) and verifies a real
 * merge; red keeps the merge and throws. `again` is the command that resumes after a fix.
 */
export async function mergeInto(
  branch: string,
  intoOption: string | undefined,
  again: string,
  logName: string,
  deps: CloseDeps,
): Promise<MergeResult> {
  const { repoRoot, config } = deps;
  const git = createGit(repoRoot, deps.run);
  const current = await git.currentBranch();
  const into = await targetBranch(intoOption, current, branch, (b) => git.branchExists(b));
  if (into === branch) {
    throw new SpecrunError('git-failed', `Cannot merge ${branch} into itself`);
  }
  if (!(await git.branchExists(into))) {
    throw new SpecrunError('git-failed', `Branch ${into} does not exist`);
  }
  if (into !== current) await git.switchBranch(into, 'HEAD');

  let merge: CloseResult['merge'] = 'already';
  const commits = await git.countCommits('HEAD', branch);
  let verify: VerifyResult | null = null;
  if (commits > 0) {
    const fastForward = await git.isAncestor('HEAD', branch);
    deps.onProgress?.({ step: 'merge', branch, into, commits, fastForward });
    const merged = await git.merge(branch, fastForward ? 'ff-only' : 'merge');
    if (!merged.ok) {
      throw new SpecrunError('git-failed', `Merging ${branch} into ${into} failed (aborted)`, [
        ...merged.error.split('\n').slice(-10),
        `merge it by hand (git merge ${branch}), then run ${again} again`,
      ]);
    }
    merge = fastForward ? 'fast-forward' : 'merge-commit';

    // Only a real merge makes a tree no task verified.
    if (!fastForward) {
      deps.onProgress?.({ step: 'verify', steps: config.verify.map((step) => step.name) });
      verify = await runVerify({
        steps: config.verify,
        cwd: repoRoot,
        logFile: join(repoRoot, '.specrun', 'logs', logName, 'close-verify.log'),
        run: deps.run,
        onStep: (finished) => deps.onProgress?.({ step: 'verify-step', finished }),
      });
      if (!verify.ok) {
        throw new SpecrunError(
          'spec-invalid',
          `Verify failed after merging ${branch} into ${into}`,
          [
            ...verify.summary.split('\n'),
            `the merge is kept and nothing is archived — fix and commit, then run ${again} again`,
          ],
        );
      }
    }
  }

  return { branch, into, merge, commits, verify };
}
