import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Config } from '../config/configSchema.js';
import { formatIssues } from '../config/loadConfig.js';
import { SpecrunError } from '../errors.js';
import { EVENTS_FILE, readEvents } from '../events/eventStore.js';
import { deriveState } from '../events/taskState.js';
import { ensureLine } from '../git/ensureLine.js';
import { createGit } from '../git/git.js';
import { worktreePath } from '../git/worktree.js';
import type { ProcessRunner } from '../process/run.js';
import { lockFile, readLockPid } from '../runner/lock.js';
import { readYamlFile, SPEC_FILE, specDir } from '../spec/loadSpec.js';
import { SpecFileSchema, SpecSchema, type Spec } from '../spec/specSchema.js';
import { deviationEntries, taskSamples } from '../stats/aggregate.js';
import { ARCHIVE_DIR, archiveRoot, HISTORY_FILE, type History } from './history.js';

export const IGNORE_FILE = '.ignore';

export interface ArchiveOptions {
  spec: string;
  /** Archive although tasks are not done or tasks.yaml is missing / invalid. */
  force: boolean;
}

export interface ArchiveDeps {
  /** Main checkout. */
  repoRoot: string;
  config: Config;
  run: ProcessRunner;
  now: () => Date;
  isAlive: (pid: number) => boolean;
}

export interface ArchiveResult {
  /** Relative to the repo root. */
  archiveDir: string;
  commit: string;
  /** HEAD before archiving: the full spec folder is in git there. */
  baseCommit: string;
  /** Null when there was no run history to keep. */
  history: { samples: number; deviations: number } | null;
  removed: { worktree: string; branch: string } | null;
  /** Tasks archived with `--force` although not done, as `<id> (<status>)`. */
  forced: string[];
}

interface SpecRead {
  spec: Spec;
  /** `status: done` in the file — specs of the old bash runner (spec-run.sh) keep their state there. */
  doneInFile: Set<string>;
}

function readSpec(dir: string, name: string): SpecRead | { problems: string[] } {
  const path = join(dir, SPEC_FILE);
  if (!existsSync(path)) return { problems: [`${SPEC_FILE} is missing`] };
  const yaml = readYamlFile(path);
  if (!yaml.ok) return { problems: [`${SPEC_FILE} is not valid YAML: ${yaml.error}`] };
  // No brief checks: the briefs are about to be removed, and old specs never had them.
  const file = SpecFileSchema.safeParse(yaml.value);
  const parsed = SpecSchema.safeParse(yaml.value);
  if (!file.success) return { problems: formatIssues(file.error) };
  if (!parsed.success) return { problems: formatIssues(parsed.error) };
  return {
    spec: { ...parsed.data, title: parsed.data.title ?? name },
    doneInFile: new Set(file.data.tasks.filter((t) => t.status === 'done').map((t) => t.id)),
  };
}

/** The spec's README with an archive note under its title (or a stub when it has none). */
function archivedReadme(readme: string | null, title: string, note: string): string {
  const text = readme ?? `# ${title}\n`;
  const lines = text.split('\n');
  const heading = lines.findIndex((line) => line.startsWith('# '));
  lines.splice(heading + 1, 0, ...(heading === -1 ? [note, ''] : ['', note]));
  return lines.join('\n');
}

interface MergedWorktree {
  path: string;
  branch: string;
}

/** The spec's worktree, when one exists; refuses unless it is clean and merged into HEAD. */
async function mergedWorktree(deps: ArchiveDeps, spec: string): Promise<MergedWorktree | null> {
  const path = worktreePath(deps.repoRoot, spec);
  if (!existsSync(path)) return null;
  const real = realpathSync(path);
  const git = createGit(deps.repoRoot, deps.run);
  const entry = (await git.worktreeList()).find(
    (e) => existsSync(e.path) && realpathSync(e.path) === real,
  );
  const rel = relative(deps.repoRoot, path);
  if (entry === undefined) {
    throw new SpecrunError('git-failed', `${rel} exists but is not a git worktree`, [
      'remove the folder, then archive again',
    ]);
  }
  if (entry.branch === null) {
    throw new SpecrunError('git-failed', `Worktree ${rel} has a detached HEAD`);
  }
  if (!(await createGit(path, deps.run).isClean())) {
    throw new SpecrunError('git-failed', `Worktree ${rel} has uncommitted changes`, [
      'commit or discard them, merge the branch, then archive again',
    ]);
  }
  if (!(await git.isAncestor(entry.branch, 'HEAD'))) {
    throw new SpecrunError('git-failed', `Branch ${entry.branch} is not merged into HEAD`, [
      `merge it first (git merge ${entry.branch}), then archive again`,
    ]);
  }
  return { path, branch: entry.branch };
}

/**
 * Replaces `<specsDir>/<spec>/` by `<specsDir>/archive/<spec>/` (README with an archive note +
 * `history.json` for stats), hides the archive from search through `.ignore`, commits only those
 * paths, then removes the spec's merged worktree and branch.
 */
export async function archiveSpec(
  options: ArchiveOptions,
  deps: ArchiveDeps,
): Promise<ArchiveResult> {
  const { repoRoot, config } = deps;
  const name = options.spec;
  const dir = specDir(repoRoot, config, name);
  const relDir = relative(repoRoot, dir);
  const archiveDir = join(archiveRoot(repoRoot, config), name);
  const relArchive = relative(repoRoot, archiveDir);

  if (!existsSync(dir)) {
    throw new SpecrunError('spec-missing', `Spec "${name}" not found: ${relDir} does not exist`);
  }
  if (existsSync(archiveDir)) {
    throw new SpecrunError('spec-invalid', `Spec "${name}" is already archived in ${relArchive}`);
  }
  const pid = readLockPid(lockFile(repoRoot, name));
  if (pid !== null && deps.isAlive(pid)) {
    throw new SpecrunError('locked', `A run holds the lock of "${name}" (pid ${pid})`, [
      'let it finish or stop it (Ctrl-C) before archiving',
    ]);
  }
  const git = createGit(repoRoot, deps.run);
  if (!(await git.isClean([relDir]))) {
    throw new SpecrunError('spec-invalid', `${relDir} has uncommitted changes`, [
      'commit or discard them first — archiving deletes the folder',
    ]);
  }
  const worktree = await mergedWorktree(deps, name);

  const read = readSpec(dir, name);
  if ('problems' in read && !options.force) {
    throw new SpecrunError('spec-invalid', `Cannot read ${relDir}/${SPEC_FILE}`, [
      ...read.problems,
      'archive with --force to keep only the README',
    ]);
  }
  const events = readEvents(join(dir, EVENTS_FILE)).events;
  const input =
    'spec' in read
      ? { name, spec: read.spec, state: deriveState(read.spec, events), events }
      : null;

  const forced: string[] = [];
  if (input !== null && 'doneInFile' in read) {
    for (const task of input.spec.tasks) {
      const status = input.state.tasks.get(task.id)?.status ?? 'todo';
      if (status !== 'done' && !read.doneInFile.has(task.id)) forced.push(`${task.id} (${status})`);
    }
  }
  if (forced.length > 0 && !options.force) {
    throw new SpecrunError('spec-invalid', `Spec "${name}" has unfinished tasks`, [
      ...forced,
      'archive with --force to archive it anyway',
    ]);
  }

  const baseCommit = await git.head();
  const short = baseCommit.slice(0, 7);
  const archivedAt = deps.now();
  const title = input?.spec.title ?? name;
  const samples = input === null ? [] : taskSamples([input]);
  const deviations = input === null ? [] : deviationEntries([input]);

  const readmePath = join(dir, 'README.md');
  const readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : null;
  const date = archivedAt.toISOString().slice(0, 10);
  const note =
    `> Archived on ${date} by \`specrun archive\`. The full spec folder (briefs, prompts, run ` +
    `log) is in git at \`${short}\`: \`git ls-tree -r --name-only ${short} -- ${relDir}\`.`;

  mkdirSync(archiveDir, { recursive: true });
  writeFileSync(join(archiveDir, 'README.md'), archivedReadme(readme, title, note));
  const keepHistory = samples.length > 0 || deviations.length > 0;
  if (keepHistory) {
    const history: History = {
      version: 1,
      spec: name,
      title,
      archivedAt: archivedAt.toISOString(),
      commit: baseCommit,
      samples,
      deviations,
    };
    writeFileSync(join(archiveDir, HISTORY_FILE), `${JSON.stringify(history, null, 2)}\n`);
  }
  rmSync(dir, { recursive: true, force: true });
  ensureLine(join(repoRoot, IGNORE_FILE), `${config.specsDir}/${ARCHIVE_DIR}/`);

  const commit = await git.commitPaths(
    { subject: `docs(${name}): archive spec`, body: '', trailers: config.commitTrailers },
    [relDir, relArchive, IGNORE_FILE],
  );
  if (commit === null) throw new SpecrunError('git-failed', 'Nothing to commit after archiving');

  if (worktree !== null) {
    await git.removeWorktree(worktree.path);
    await git.deleteBranch(worktree.branch);
  }
  return {
    archiveDir: relArchive,
    commit,
    baseCommit,
    history: keepHistory ? { samples: samples.length, deviations: deviations.length } : null,
    removed:
      worktree === null
        ? null
        : { worktree: relative(repoRoot, worktree.path), branch: worktree.branch },
    forced,
  };
}
