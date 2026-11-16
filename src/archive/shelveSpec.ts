import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SpecrunError } from '../errors.js';
import { createGit } from '../git/git.js';
import { runsShared, SHARED_BRANCH } from '../git/workspace.js';
import { worktreePath } from '../git/worktree.js';
import { lockFile, readLockPid } from '../runner/lock.js';
import { loadSpec, specDir } from '../spec/loadSpec.js';
import {
  oneLine,
  readArchiveSource,
  writeArchive,
  type ArchiveDeps,
  type WrittenArchive,
} from './archiveSpec.js';
import { targetBranch } from './closeSpec.js';
import { archiveRoot, refuseShelved } from './history.js';

export interface ShelveOptions {
  spec: string;
  reason: string;
  /** Null: `--no-push`, the branch stays local only. */
  remote: string | null;
}

export type ShelveStep =
  | { step: 'push'; remote: string; branch: string }
  | { step: 'switch'; branch: string }
  | { step: 'archive'; spec: string };

export interface ShelveDeps extends ArchiveDeps {
  /** Before the slow steps, so a terminal shows what runs. */
  onProgress?: (step: ShelveStep) => void;
}

export interface ShelveResult {
  branch: string;
  /** The branch's commit that was shelved (and pushed). */
  tip: string;
  remote: string | null;
  archive: WrittenArchive;
  /** Relative to the repo root; null with `"worktree": false`. */
  removedWorktree: string | null;
  /** `"worktree": false`: the branch the checkout was switched back to. */
  switchedTo: string | null;
}

/**
 * SRD-35: keeps a spec's work on its branch (pushed unless `remote` is null), archives the spec
 * without merging — README note and history.json from the live copy — and removes the worktree.
 * The branch stays. All checks and the push come before anything changes locally.
 */
export async function shelveSpec(options: ShelveOptions, deps: ShelveDeps): Promise<ShelveResult> {
  const { repoRoot, config } = deps;
  const name = options.spec;
  const { remote } = options;
  const reason = oneLine(options.reason);
  if (reason === '') {
    throw new SpecrunError('spec-invalid', 'Shelving needs a reason', ['pass --reason <text>']);
  }
  const git = createGit(repoRoot, deps.run);

  refuseShelved(repoRoot, config, name);
  const archiveDir = relative(repoRoot, join(archiveRoot(repoRoot, config), name));
  if (existsSync(join(repoRoot, archiveDir))) {
    throw new SpecrunError('spec-invalid', `Spec "${name}" is already archived in ${archiveDir}`);
  }
  const pid = readLockPid(lockFile(repoRoot, name));
  if (pid !== null && deps.isAlive(pid)) {
    throw new SpecrunError('locked', `A run holds the lock of "${name}" (pid ${pid})`, [
      'let it finish or stop it before shelving',
    ]);
  }
  if (runsShared(repoRoot, config, name)) {
    throw new SpecrunError('spec-invalid', `"${name}" runs on ${SHARED_BRANCH} with other specs`, [
      'shelving a spec of specrun run --all is not supported',
    ]);
  }

  // The live copy (SRD-4): the spec's worktree, or the checkout left on its branch.
  const worktree = worktreePath(repoRoot, name);
  const live = existsSync(worktree) ? worktree : repoRoot;
  const liveGit = createGit(live, deps.run);
  const branch = loadSpec(live, config, name).spec.branch ?? `specrun/${name}`;
  const current = await git.currentBranch();
  if ((await liveGit.currentBranch()) !== branch) {
    const rel = relative(repoRoot, worktree);
    throw new SpecrunError('spec-invalid', `Spec "${name}" has no workspace on ${branch}`, [
      (await git.branchExists(branch))
        ? `recreate the worktree (git worktree add ${rel} ${branch}), then shelve again`
        : 'nothing to shelve — specrun run creates the branch',
    ]);
  }
  if (!(await liveGit.isClean())) {
    throw new SpecrunError(
      'git-failed',
      `${relative(repoRoot, live) || '.'} has uncommitted changes`,
      ['commit or discard them first — only committed work is shelved'],
    );
  }
  const relDir = relative(repoRoot, specDir(repoRoot, config, name));
  if (live === worktree && !(await git.isClean([relDir]))) {
    throw new SpecrunError('checkout-dirty', `${relDir} has uncommitted changes`, [
      'commit or discard them first — shelving deletes the folder',
    ]);
  }
  if (remote !== null && !(await git.remoteExists(remote))) {
    throw new SpecrunError('git-failed', `No remote "${remote}"`, [
      'add it (git remote add), name another with --remote, or keep the branch local with --no-push',
    ]);
  }
  // Read before the checkout leaves the branch.
  const source = readArchiveSource(specDir(live, config, name), relDir, name, true);

  if (remote !== null) {
    deps.onProgress?.({ step: 'push', remote, branch });
    const pushed = await git.push(remote, branch);
    if (!pushed.ok) {
      throw new SpecrunError('git-failed', `Pushing ${branch} to ${remote} failed`, [
        ...pushed.error.split('\n').slice(-10),
        'nothing was changed — fix it and shelve again, or keep the branch local with --no-push',
      ]);
    }
  }
  const tip = await git.resolve(branch);

  let switchedTo: string | null = null;
  if (live === repoRoot) {
    const base = await targetBranch(undefined, current, branch, (b) => git.branchExists(b));
    deps.onProgress?.({ step: 'switch', branch: base });
    await git.switchBranch(base, 'HEAD');
    switchedTo = base;
  }

  deps.onProgress?.({ step: 'archive', spec: name });
  const short = tip.slice(0, 7);
  const where = remote === null ? 'local only' : `pushed to ${remote}`;
  const archive = await writeArchive(
    {
      spec: name,
      source,
      note: ({ date, relDir: rel }) =>
        `> Shelved on ${date} by \`specrun shelve\` — not merged. Reason: ${reason}. The work is ` +
        `on branch \`${branch}\` at \`${short}\` (${where}); \`specrun unshelve ${name}\` ` +
        `merges it. The spec folder with its run log: ` +
        `\`git ls-tree -r --name-only ${short} -- ${rel}\`.`,
      outcome: {
        kind: 'shelved',
        shelvedAt: deps.now().toISOString(),
        reason,
        branch,
        remote,
        tip,
      },
      subject: `docs(${name}): shelve spec`,
    },
    deps,
  );

  let removedWorktree: string | null = null;
  if (live === worktree) {
    await git.removeWorktree(worktree);
    removedWorktree = relative(repoRoot, worktree);
  }
  return { branch, tip, remote, archive, removedWorktree, switchedTo };
}
