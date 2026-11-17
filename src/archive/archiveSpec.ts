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
import {
  deviationEntries,
  planningSummary,
  taskSamples,
  type DeviationEntry,
  type TaskSample,
} from '../stats/aggregate.js';
import type { PlanningSummary } from '../stats/jsonOutput.js';
import {
  ARCHIVE_DIR,
  archiveRoot,
  HISTORY_FILE,
  refuseShelved,
  type History,
  type Outcome,
} from './history.js';

export const IGNORE_FILE = '.ignore';

export interface ArchiveOptions {
  spec: string;
  /** Archive although tasks are not done or tasks.yaml is missing / invalid. */
  force: boolean;
  /** Set by `specrun unshelve`: when and why the spec was shelved before this merge. */
  shelved?: { shelvedAt: string; reason: string };
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

/** What an archive keeps of a spec, read before anything changes. */
export interface ArchiveSource {
  title: string;
  readme: string | null;
  samples: TaskSample[];
  deviations: DeviationEntry[];
  planning: PlanningSummary | null;
  /** Tasks neither done in events nor `status: done` in tasks.yaml, as `<id> (<status>)`. */
  unfinished: string[];
}

/**
 * Reads the spec folder `dir`; `label` names it in errors. An unreadable tasks.yaml throws unless
 * `force` — then only the README is kept.
 */
export function readArchiveSource(
  dir: string,
  label: string,
  name: string,
  force: boolean,
): ArchiveSource {
  const read = readSpec(dir, name);
  if ('problems' in read && !force) {
    throw new SpecrunError('spec-invalid', `Cannot read ${label}/${SPEC_FILE}`, [
      ...read.problems,
      'archive with --force to keep only the README',
    ]);
  }
  const events = readEvents(join(dir, EVENTS_FILE)).events;
  const input =
    'spec' in read
      ? { name, spec: read.spec, state: deriveState(read.spec, events), events }
      : null;
  const unfinished: string[] = [];
  if (input !== null && 'doneInFile' in read) {
    for (const task of input.spec.tasks) {
      const status = input.state.tasks.get(task.id)?.status ?? 'todo';
      if (status !== 'done' && !read.doneInFile.has(task.id)) {
        unfinished.push(`${task.id} (${status})`);
      }
    }
  }
  const readmePath = join(dir, 'README.md');
  return {
    title: input?.spec.title ?? name,
    readme: existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : null,
    samples: input === null ? [] : taskSamples([input]),
    deviations: input === null ? [] : deviationEntries([input]),
    planning: planningSummary(events),
    unfinished,
  };
}

export interface ArchiveWrite {
  spec: string;
  source: ArchiveSource;
  /** The archive note under the README's title; `base` is HEAD before the archive commit. */
  note: (at: { date: string; base: string; relDir: string }) => string;
  outcome: Outcome;
  subject: string;
}

export type WrittenArchive = Omit<ArchiveResult, 'removed'>;

/**
 * Writes `<specsDir>/archive/<spec>/` (README with the note, `history.json` when there is anything
 * to keep), removes the spec folder of the main checkout when it has one, hides the archive from
 * search through `.ignore` and commits only those paths.
 */
export async function writeArchive(
  write: ArchiveWrite,
  deps: ArchiveDeps,
): Promise<WrittenArchive> {
  const { repoRoot, config } = deps;
  const { spec: name, source, outcome } = write;
  const dir = specDir(repoRoot, config, name);
  const relDir = relative(repoRoot, dir);
  const archiveDir = join(archiveRoot(repoRoot, config), name);
  const relArchive = relative(repoRoot, archiveDir);
  const git = createGit(repoRoot, deps.run);

  const baseCommit = await git.head();
  const archivedAt = deps.now();
  const date = archivedAt.toISOString().slice(0, 10);
  const note = write.note({ date, base: baseCommit.slice(0, 7), relDir });

  mkdirSync(archiveDir, { recursive: true });
  writeFileSync(join(archiveDir, 'README.md'), archivedReadme(source.readme, source.title, note));
  const counts = source.samples.length > 0 || source.deviations.length > 0;
  // A shelved spec always keeps it: unshelve reads where its work is from there.
  const keepHistory =
    counts || outcome.kind === 'shelved' || outcome.shelved !== null || source.planning !== null;
  if (keepHistory) {
    const history: History = {
      version: 1,
      spec: name,
      title: source.title,
      archivedAt: archivedAt.toISOString(),
      commit: baseCommit,
      outcome,
      planning: source.planning,
      samples: source.samples,
      deviations: source.deviations,
    };
    writeFileSync(join(archiveDir, HISTORY_FILE), `${JSON.stringify(history, null, 2)}\n`);
  }
  // A spec written on its branch only has no folder in the main checkout.
  const hadDir = existsSync(dir);
  rmSync(dir, { recursive: true, force: true });
  ensureLine(join(repoRoot, IGNORE_FILE), `${config.specsDir}/${ARCHIVE_DIR}/`);

  const commit = await git.commitPaths(
    { subject: write.subject, body: '', trailers: config.commitTrailers },
    [...(hadDir ? [relDir] : []), relArchive, IGNORE_FILE],
  );
  if (commit === null) throw new SpecrunError('git-failed', 'Nothing to commit after archiving');
  return {
    archiveDir: relArchive,
    commit,
    baseCommit,
    history: counts
      ? { samples: source.samples.length, deviations: source.deviations.length }
      : null,
    forced: source.unfinished,
  };
}

/**
 * Replaces `<specsDir>/<spec>/` by `<specsDir>/archive/<spec>/` (README with an archive note +
 * `history.json` for stats), then removes the spec's merged worktree and branch.
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

  refuseShelved(repoRoot, config, name);
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

  const source = readArchiveSource(dir, relDir, name, options.force);
  if (source.unfinished.length > 0 && !options.force) {
    throw new SpecrunError('spec-invalid', `Spec "${name}" has unfinished tasks`, [
      ...source.unfinished,
      'archive with --force to archive it anyway',
    ]);
  }

  const shelved = options.shelved ?? null;
  const written = await writeArchive(
    {
      spec: name,
      source,
      note: ({ date, base, relDir: rel }) => {
        const archived =
          `> Archived on ${date} by \`specrun archive\`. The full spec folder (briefs, prompts, ` +
          `run log) is in git at \`${base}\`: \`git ls-tree -r --name-only ${base} -- ${rel}\`.`;
        return shelved === null
          ? archived
          : `${archived} It was shelved on ${shelved.shelvedAt.slice(0, 10)} ` +
              `(${oneLine(shelved.reason)}) and merged by \`specrun unshelve\`.`;
      },
      outcome: { kind: 'merged', shelved },
      subject: `docs(${name}): archive spec`,
    },
    deps,
  );

  if (worktree !== null) {
    await git.removeWorktree(worktree.path);
    // Checked merged into HEAD above; `-d` would also want a pushed branch (shelve) in its upstream.
    await git.deleteBranch(worktree.branch, true);
  }
  return {
    ...written,
    removed:
      worktree === null
        ? null
        : { worktree: relative(repoRoot, worktree.path), branch: worktree.branch },
  };
}

/** Archive notes are one blockquote line. */
export function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ').trim();
}
