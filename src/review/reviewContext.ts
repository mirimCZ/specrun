import { existsSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { archiveRoot, type History } from '../archive/history.js';
import type { Config } from '../config/configSchema.js';
import { CONFIG_FILE } from '../config/loadConfig.js';
import { createGit } from '../git/git.js';
import type { ProcessRunner } from '../process/run.js';
import { specDir } from '../spec/loadSpec.js';
import type { DeviationEntry, SpecInput } from '../stats/aggregate.js';
import { activeSpecFiles } from '../cli/cliDeps.js';

// Budgets keep the context a fraction of the window; what is left out is named, so Claude can
// still read it.
export const BRIEF_BUDGET = 120_000;
export const DIFF_BUDGET = 40_000;
const MAX_DIFF_CHARS = 8_000;

/** Where a reviewed spec's files are; paths relative to the repo root, where Claude starts. */
export type ReviewLocation =
  | {
      kind: 'live';
      files: string;
      worktree: string | null;
      branch: string;
      /** Whether the branch is merged into HEAD; null when the branch doesn't exist. */
      merged: boolean | null;
    }
  | { kind: 'archived'; files: string; commit: string; original: string };

export interface ReviewCommit {
  sha: string;
  /** Without specrun's trailers. */
  message: string;
  /** `+ins −del path`, specrun's own PROGRESS.md / events.jsonl left out. */
  files: string[];
  /** Files a deviation names, truncated. */
  diffs: { path: string; diff: string }[];
}

export interface ReviewTask {
  id: string;
  title: string | null;
  deviations: DeviationEntry[];
  briefPath: string;
  /** null when missing or over the budget. */
  brief: string | null;
  commit: ReviewCommit | null;
}

export interface NextIds {
  task: string | null;
  decision: string | null;
  question: string | null;
}

export interface ReviewSpecContext {
  name: string;
  title: string;
  location: ReviewLocation;
  taskPrompt: string | null;
  readmePath: string;
  /** README table rows of the decisions the deviations mention, verbatim. */
  decisions: string[];
  /** 1-based line of the last row, so new rows can be added without reading the whole README. */
  lastRow: { decision: number | null; question: number | null };
  next: NextIds;
  tasks: ReviewTask[];
}

export interface ReviewContext {
  /** specrun.config.json as written; null when unreadable. */
  config: string | null;
  specs: ReviewSpecContext[];
}

export interface GatherInput {
  repoRoot: string;
  config: Config;
  inputs: readonly SpecInput[];
  archived: readonly History[];
  entries: readonly DeviationEntry[];
  run: ProcessRunner;
}

const DECISION_REF = /\b[A-Z][A-Z0-9]*D-\d+\b/g;
const DECISION_ROW = /^\|\s*([A-Z][A-Z0-9]*D)-(\d+)\s*\|/;
const QUESTION_ROW = /^\|\s*Q(\d+)\s*\|/;
const TASK_ID = /^([A-Z][A-Z0-9]*)-(\d+)$/;

function readText(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

function deviationText(e: DeviationEntry): string {
  const question = e.question === null ? '' : `${e.question.text} ${e.question.options.join(' ')}`;
  return `${e.decision ?? ''} ${e.what} ${e.why} ${question}`;
}

function nextTaskId(ids: readonly string[]): string | null {
  let prefix: string | null = null;
  let max = 0;
  for (const id of ids) {
    const match = TASK_ID.exec(id);
    if (match?.[1] === undefined) continue;
    prefix ??= match[1];
    if (match[1] === prefix) max = Math.max(max, Number(match[2]));
  }
  return prefix === null ? null : `${prefix}-${max + 1}`;
}

interface ReadmeFacts {
  decisions: string[];
  lastRow: ReviewSpecContext['lastRow'];
  next: Omit<NextIds, 'task'>;
}

export function readmeFacts(readme: string | null, referenced: ReadonlySet<string>): ReadmeFacts {
  const facts: ReadmeFacts = {
    decisions: [],
    lastRow: { decision: null, question: null },
    next: { decision: null, question: null },
  };
  if (readme === null) return facts;
  const prefixes = new Map<string, { rows: number; max: number }>();
  let maxQuestion = 0;
  readme.split('\n').forEach((line, index) => {
    const decision = DECISION_ROW.exec(line);
    if (decision?.[1] !== undefined) {
      const id = `${decision[1]}-${decision[2]}`;
      if (referenced.has(id)) facts.decisions.push(line);
      const seen = prefixes.get(decision[1]) ?? { rows: 0, max: 0 };
      prefixes.set(decision[1], {
        rows: seen.rows + 1,
        max: Math.max(seen.max, Number(decision[2])),
      });
      facts.lastRow.decision = index + 1;
    }
    const question = QUESTION_ROW.exec(line);
    if (question !== null) {
      maxQuestion = Math.max(maxQuestion, Number(question[1]));
      facts.lastRow.question = index + 1;
    }
  });
  // A README may quote rows of another spec's log; its own log is the longest.
  const own = [...prefixes.entries()].sort((a, b) => b[1].rows - a[1].rows)[0];
  if (own !== undefined) facts.next.decision = `${own[0]}-${own[1].max + 1}`;
  if (facts.lastRow.question !== null) facts.next.question = `Q${maxQuestion + 1}`;
  return facts;
}

// Agents name files by basename or by the component / module name (`DrawingPanel`); short stems
// (`index`, `common`) would match everywhere.
const MIN_STEM = 8;

function mentioned(path: string, text: string): boolean {
  const name = basename(path);
  const stem = name.replace(/(\.spec)?\.[^.]+$/, '');
  return text.includes(name) || (stem.length >= MIN_STEM && text.includes(stem));
}

const SPECRUN_FILES = /(^|\/)(PROGRESS\.md|events\.jsonl)$/;

interface Budget {
  briefs: number;
  diffs: number;
}

async function commitDetails(
  repoRoot: string,
  sha: string,
  mentions: string,
  budget: Budget,
  run: ProcessRunner,
): Promise<ReviewCommit | null> {
  const show = async (args: string[]): Promise<string | null> => {
    const result = await run('git', ['show', ...args], { cwd: repoRoot });
    return result.code === 0 ? result.stdout : null;
  };
  const message = await show(['--no-patch', '--format=%B', sha]);
  const numstat = await show(['--format=', '--numstat', sha]);
  if (message === null || numstat === null) return null;

  const paths: string[] = [];
  const files: string[] = [];
  for (const line of numstat.split('\n')) {
    const [ins, del, path] = line.split('\t');
    if (path === undefined || SPECRUN_FILES.test(path)) continue;
    paths.push(path);
    files.push(`+${ins} −${del} ${path}`);
  }
  const diffs: ReviewCommit['diffs'] = [];
  for (const path of paths.filter((p) => mentioned(p, mentions))) {
    if (budget.diffs <= 0) break;
    const diff = await show(['--format=', sha, '--', path]);
    if (diff === null) continue;
    const limit = Math.min(MAX_DIFF_CHARS, budget.diffs);
    const text = diff.length > limit ? `${diff.slice(0, limit)}\n… (truncated)` : diff;
    budget.diffs -= text.length;
    diffs.push({ path, diff: text.trimEnd() });
  }
  return {
    sha,
    message: message
      .split('\n')
      .filter((line) => !line.startsWith('Specrun-'))
      .join('\n')
      .trim(),
    files,
    diffs,
  };
}

function takeBrief(text: string | null, budget: Budget): string | null {
  if (text === null || text.length > budget.briefs) return null;
  budget.briefs -= text.length;
  return text;
}

function byTask(entries: readonly DeviationEntry[], spec: string): Map<string, DeviationEntry[]> {
  const tasks = new Map<string, DeviationEntry[]>();
  for (const e of entries) {
    if (e.spec !== spec) continue;
    tasks.set(e.task, [...(tasks.get(e.task) ?? []), e]);
  }
  return tasks;
}

function referencedDecisions(entries: readonly DeviationEntry[]): Set<string> {
  return new Set(entries.flatMap((e) => deviationText(e).match(DECISION_REF) ?? []));
}

/** Everything the review would otherwise look up first: config, briefs, commits, decisions. */
export async function gatherReviewContext(input: GatherInput): Promise<ReviewContext> {
  const { repoRoot, config, entries, run } = input;
  const git = createGit(repoRoot, run);
  const rel = (path: string): string => relative(repoRoot, path) || '.';
  const budget: Budget = { briefs: BRIEF_BUDGET, diffs: DIFF_BUDGET };
  const specs: ReviewSpecContext[] = [];

  for (const { name, spec, state } of input.inputs) {
    const tasks = byTask(entries, name);
    if (tasks.size === 0) continue;
    const files = activeSpecFiles(repoRoot, config, name);
    const dir = specDir(files.base, config, name);
    const branch = spec.branch ?? `specrun/${name}`;
    const readme = readText(join(dir, 'README.md'));
    const facts = readmeFacts(readme, referencedDecisions([...tasks.values()].flat()));
    const reviewTasks: ReviewTask[] = [];
    for (const task of spec.tasks) {
      const deviations = tasks.get(task.id);
      if (deviations === undefined) continue;
      const sha = state.tasks.get(task.id)?.commit ?? null;
      const briefPath = join(dir, 'tasks', `${task.id}.md`);
      reviewTasks.push({
        id: task.id,
        title: task.title,
        deviations,
        briefPath: rel(briefPath),
        brief: takeBrief(readText(briefPath), budget),
        commit:
          sha === null
            ? null
            : await commitDetails(
                repoRoot,
                sha,
                deviations.map(deviationText).join(' '),
                budget,
                run,
              ),
      });
    }
    specs.push({
      name,
      title: spec.title ?? name,
      location: {
        kind: 'live',
        files: rel(dir),
        worktree: files.worktree === null ? null : rel(files.worktree),
        branch,
        merged: (await git.branchExists(branch)) ? await git.isAncestor(branch, 'HEAD') : null,
      },
      taskPrompt: readText(join(dir, 'TASK_PROMPT.md')),
      readmePath: rel(join(dir, 'README.md')),
      decisions: facts.decisions,
      lastRow: facts.lastRow,
      next: { task: nextTaskId(spec.tasks.map((t) => t.id)), ...facts.next },
      tasks: reviewTasks,
    });
  }

  for (const history of input.archived) {
    const tasks = byTask(entries, history.spec);
    if (tasks.size === 0) continue;
    const dir = join(archiveRoot(repoRoot, config), history.spec);
    const original = join(config.specsDir, history.spec);
    const atCommit = async (path: string): Promise<string | null> => {
      const result = await run('git', ['show', `${history.commit}:${path}`], { cwd: repoRoot });
      return result.code === 0 ? result.stdout : null;
    };
    const readme = readText(join(dir, 'README.md'));
    const facts = readmeFacts(readme, referencedDecisions([...tasks.values()].flat()));
    const reviewTasks: ReviewTask[] = [];
    for (const [id, deviations] of tasks) {
      const briefPath = join(original, 'tasks', `${id}.md`);
      const found = await run(
        'git',
        ['log', '-1', '--format=%H', `--grep=^Specrun-Task: ${id}$`, history.commit],
        { cwd: repoRoot },
      );
      const sha = found.code === 0 && found.stdout.trim() !== '' ? found.stdout.trim() : null;
      reviewTasks.push({
        id,
        title: null,
        deviations,
        briefPath: `${history.commit.slice(0, 7)}:${briefPath}`,
        brief: takeBrief(await atCommit(briefPath), budget),
        commit:
          sha === null
            ? null
            : await commitDetails(
                repoRoot,
                sha,
                deviations.map(deviationText).join(' '),
                budget,
                run,
              ),
      });
    }
    specs.push({
      name: history.spec,
      title: history.title,
      location: { kind: 'archived', files: rel(dir), commit: history.commit, original },
      taskPrompt: await atCommit(join(original, 'TASK_PROMPT.md')),
      readmePath: rel(join(dir, 'README.md')),
      decisions: facts.decisions,
      lastRow: facts.lastRow,
      // Archived specs get no fix tasks (the review proposes a follow-up spec).
      next: { task: null, ...facts.next },
      tasks: reviewTasks,
    });
  }

  return { config: readText(join(repoRoot, CONFIG_FILE)), specs };
}
