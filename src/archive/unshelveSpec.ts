import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse } from 'yaml';
import { formatIssues } from '../config/loadConfig.js';
import { SpecrunError } from '../errors.js';
import { completeEvent, EVENTS_FILE, parseEvents } from '../events/eventStore.js';
import { deriveState } from '../events/taskState.js';
import { createGit, type Git } from '../git/git.js';
import { worktreePath } from '../git/worktree.js';
import { lockFile, readLockPid } from '../runner/lock.js';
import { SPEC_FILE, specDir } from '../spec/loadSpec.js';
import { SpecSchema } from '../spec/specSchema.js';
import { deviationId } from '../stats/aggregate.js';
import { archiveSpec, type ArchiveDeps, type ArchiveResult } from './archiveSpec.js';
import { mergeInto, targetBranch, type CloseStep, type MergeResult } from './closeSpec.js';
import { archiveRoot, isShelved, readArchivedHistory } from './history.js';

export interface UnshelveOptions {
  spec: string;
  /** Branch to revive the spec on and merge into; default the main checkout's current one. */
  into?: string;
  /** Merge and archive although tasks are unfinished. */
  force: boolean;
  /** False (`--no-merge`): only make the spec live again, for `specrun run`. */
  merge: boolean;
}

export type UnshelveStep =
  | { step: 'fetch'; remote: string; branch: string }
  | { step: 'revive'; spec: string; into: string }
  | CloseStep;

export interface UnshelveDeps extends ArchiveDeps {
  /** Before the slow steps, so a terminal shows what runs. */
  onProgress?: (step: UnshelveStep) => void;
}

/** How the local branch relates to the one the remote has. */
export type BranchSync =
  | { kind: 'local-only' }
  | { kind: 'up-to-date' }
  | { kind: 'created' }
  | { kind: 'fast-forwarded' }
  | { kind: 'local-ahead' }
  | { kind: 'unreachable'; error: string };

export interface UnshelveResult {
  branch: string;
  remote: string | null;
  sync: BranchSync;
  into: string;
  /** The commit that brought the spec folder back. */
  revived: string;
  /** Reviewed deviations of history.json, recorded in the branch's log again. */
  carriedReviewed: number;
  /** Null with `--no-merge`. */
  closed: (MergeResult & { archive: ArchiveResult; deletedBranch: string | null }) | null;
}

/** The local branch as fresh as the remote's; refuses when they have diverged. */
async function syncBranch(
  git: Git,
  remote: string | null,
  branch: string,
  deps: UnshelveDeps,
): Promise<BranchSync> {
  const local = await git.branchExists(branch);
  if (remote === null) {
    if (!local) {
      throw new SpecrunError('git-failed', `Branch ${branch} does not exist`, [
        'it was shelved with --no-push, so only this repository had it',
      ]);
    }
    return { kind: 'local-only' };
  }
  deps.onProgress?.({ step: 'fetch', remote, branch });
  const fetched = await git.fetchBranch(remote, branch);
  if (!fetched.ok) {
    if (local) return { kind: 'unreachable', error: fetched.error };
    throw new SpecrunError('git-failed', `Fetching ${branch} from ${remote} failed`, [
      ...fetched.error.split('\n').slice(-10),
      'the branch does not exist locally either',
    ]);
  }
  const ref = `refs/heads/${branch}`;
  if (!local) {
    await git.updateRef(ref, fetched.sha);
    return { kind: 'created' };
  }
  const sha = await git.resolve(ref);
  if (sha === fetched.sha) return { kind: 'up-to-date' };
  if (await git.isAncestor(sha, fetched.sha)) {
    await git.updateRef(ref, fetched.sha);
    return { kind: 'fast-forwarded' };
  }
  if (await git.isAncestor(fetched.sha, sha)) return { kind: 'local-ahead' };
  throw new SpecrunError('git-failed', `${branch} and ${remote}/${branch} have diverged`, [
    'merge or reset one of them by hand, then unshelve again',
  ]);
}

/** Tasks not done according to the branch's own copy of the spec and its log. */
async function unfinishedOnBranch(
  git: Git,
  branch: string,
  relDir: string,
  name: string,
): Promise<string[]> {
  const path = `${relDir}/${SPEC_FILE}`;
  const yaml = await git.showFile(branch, path);
  if (yaml === null) {
    throw new SpecrunError('spec-missing', `${branch} has no ${path}`, [
      'unshelve with --force to merge it anyway',
    ]);
  }
  let value: unknown;
  try {
    value = parse(yaml);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SpecrunError('spec-invalid', `${branch}:${path} is not valid YAML`, [message]);
  }
  const parsed = SpecSchema.safeParse(value);
  if (!parsed.success) {
    throw new SpecrunError('spec-invalid', `${branch}:${path} is invalid`, [
      ...formatIssues(parsed.error),
      'unshelve with --force to merge it anyway',
    ]);
  }
  const spec = { ...parsed.data, title: parsed.data.title ?? name };
  const logPath = `${relDir}/${EVENTS_FILE}`;
  const log = (await git.showFile(branch, logPath)) ?? '';
  const state = deriveState(spec, parseEvents(log, `${branch}:${logPath}`).events);
  return spec.tasks
    .map((task) => ({ id: task.id, status: state.tasks.get(task.id)?.status ?? 'todo' }))
    .filter((task) => task.status !== 'done')
    .map((task) => `${task.id} (${task.status})`);
}

/**
 * SRD-36: brings a shelved spec back — the branch from its remote when needed, the spec folder as
 * before the shelve, the review marks of history.json into the branch's log — then, unless
 * `merge` is false, merges and archives it like `specrun close`.
 */
export async function unshelveSpec(
  options: UnshelveOptions,
  deps: UnshelveDeps,
): Promise<UnshelveResult> {
  const { repoRoot, config } = deps;
  const name = options.spec;
  const git = createGit(repoRoot, deps.run);
  const archiveDir = join(archiveRoot(repoRoot, config), name);
  const relArchive = relative(repoRoot, archiveDir);
  const relDir = relative(repoRoot, specDir(repoRoot, config, name));

  const history = readArchivedHistory(repoRoot, config, name);
  if (!isShelved(history)) {
    throw new SpecrunError('spec-invalid', `Spec "${name}" is not shelved`, [
      existsSync(archiveDir)
        ? `${relArchive} is the archive of a merged spec`
        : `there is no ${relArchive}`,
    ]);
  }
  const { branch, remote, shelvedAt, reason } = history.outcome;
  const pid = readLockPid(lockFile(repoRoot, name));
  if (pid !== null && deps.isAlive(pid)) {
    throw new SpecrunError('locked', `A run holds the lock of "${name}" (pid ${pid})`, [
      'let it finish or stop it before unshelving',
    ]);
  }
  if (existsSync(specDir(repoRoot, config, name))) {
    throw new SpecrunError('spec-invalid', `${relDir} exists next to the shelved spec`, [
      'remove or rename it first',
    ]);
  }
  // Updating the branch ref under a checkout of it would leave that checkout behind.
  const checkedOut = (await git.worktreeList()).find((entry) => entry.branch === branch);
  if (checkedOut !== undefined) {
    throw new SpecrunError('worktree-exists', `${branch} is checked out in ${checkedOut.path}`, [
      'switch that checkout to another branch or remove the worktree first',
    ]);
  }
  if (existsSync(worktreePath(repoRoot, name))) {
    throw new SpecrunError(
      'worktree-exists',
      `${relative(repoRoot, worktreePath(repoRoot, name))} exists`,
      ['remove it first — the next specrun run creates the worktree again'],
    );
  }
  if (!(await git.isClean())) {
    throw new SpecrunError('checkout-dirty', `The main checkout ${repoRoot} has changes`, [
      'commit or stash them before unshelving',
    ]);
  }

  const sync = await syncBranch(git, remote, branch, deps);
  if (options.merge && !options.force) {
    const open = await unfinishedOnBranch(git, branch, relDir, name);
    if (open.length > 0) {
      throw new SpecrunError('spec-invalid', `Spec "${name}" has unfinished tasks`, [
        ...open,
        'unshelve with --force to merge it anyway, or with --no-merge to finish it first',
      ]);
    }
  }
  const current = await git.currentBranch();
  const into = await targetBranch(options.into, current, branch, (b) => git.branchExists(b));
  if (!(await git.branchExists(into))) {
    throw new SpecrunError('git-failed', `Branch ${into} does not exist`);
  }

  // Before anything changes the checkout: a failure here leaves only the extra branch commit.
  const reviewed = history.deviations.filter((d) => d.reviewed);
  if (reviewed.length > 0) {
    const logPath = `${relDir}/${EVENTS_FILE}`;
    const log = (await git.showFile(branch, logPath)) ?? '';
    const event = completeEvent(
      {
        t: 'deviations.reviewed',
        deviations: reviewed.map((d) => ({ task: d.task, id: deviationId(d) })),
      },
      `unshelve-${randomUUID()}`,
      deps.now(),
    );
    const separator = log === '' || log.endsWith('\n') ? '' : '\n';
    await git.commitFileOnBranch(branch, logPath, `${log}${separator}${JSON.stringify(event)}\n`, {
      subject: `chore(specrun): ${name} reviewed deviations`,
      body: '',
      trailers: config.commitTrailers,
    });
  }

  if (into !== current) await git.switchBranch(into, 'HEAD');
  deps.onProgress?.({ step: 'revive', spec: name, into });
  // The folder as the main branch had it, so the merge brings the branch's changes without a
  // modify/delete conflict.
  const hadDir = await git.hasPath(history.commit, relDir);
  if (hadDir) await git.restorePaths(history.commit, [relDir]);
  rmSync(archiveDir, { recursive: true, force: true });
  const revived = await git.commitPaths(
    { subject: `docs(${name}): unshelve spec`, body: '', trailers: config.commitTrailers },
    [...(hadDir ? [relDir] : []), relArchive],
  );
  if (revived === null) throw new SpecrunError('git-failed', 'Nothing to commit after unshelving');

  const result = {
    branch,
    remote,
    sync,
    into,
    revived,
    carriedReviewed: reviewed.length,
  };
  if (!options.merge) return { ...result, closed: null };

  const merged = await mergeInto(branch, into, `specrun close ${name}`, name, deps);
  deps.onProgress?.({ step: 'archive', spec: name });
  const archive = await archiveSpec(
    { spec: name, force: options.force, shelved: { shelvedAt, reason } },
    deps,
  );
  let deletedBranch: string | null = null;
  // `-d` also wants it merged into its upstream, which lacks the review-marks commit.
  if ((await git.branchExists(branch)) && (await git.isAncestor(branch, 'HEAD'))) {
    await git.deleteBranch(branch, true);
    deletedBranch = branch;
  }
  return { ...result, closed: { ...merged, archive, deletedBranch } };
}
