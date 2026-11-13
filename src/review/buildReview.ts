import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { formatDeviation } from '../cli/deviationListing.js';
import type {
  ReviewCommit,
  ReviewContext,
  ReviewSpecContext,
  ReviewTask,
} from './reviewContext.js';

/** Next to the compiled module in `dist/review/` (copied by the build) and in `src/review/`. */
export const REVIEW_PROMPT_PATH = fileURLToPath(new URL('./reviewPrompt.md', import.meta.url));

export interface ReviewInput {
  /** The `specrun review …` command line. */
  command: string;
  listing: string;
  context: ReviewContext;
  instructions?: string;
}

export interface ReviewPrompt {
  /** Appended to Claude Code's system prompt: how to review, and everything gathered for it. */
  systemPrompt: string;
  /** The first user message: what to review, so the user sees it in the session too. */
  message: string;
}

// Briefs and diffs contain code fences of their own, so they are wrapped in tags instead.
function tagged(tag: string, attrs: string, body: string): string {
  return `<${tag}${attrs === '' ? '' : ` ${attrs}`}>\n${body.trimEnd()}\n</${tag}>`;
}

function locationLines(spec: ReviewSpecContext): string[] {
  const { location } = spec;
  if (location.kind === 'archived') {
    return [
      `- Archived in ${location.files}; the full spec is at commit ${location.commit.slice(0, 7)} (${location.original}). No fix tasks here — propose a follow-up spec.`,
    ];
  }
  const merged =
    location.merged === null
      ? 'does not exist'
      : location.merged
        ? 'merged into HEAD'
        : 'not merged into HEAD';
  return [
    `- Spec files: ${location.files}`,
    `- Branch ${location.branch}: ${merged}`,
    location.worktree === null
      ? '- No worktree.'
      : `- Worktree ${location.worktree} — the next run reads this copy; edit the spec there.`,
  ];
}

function readmeLines(spec: ReviewSpecContext): string[] {
  const rows = [
    spec.lastRow.decision === null ? null : `decision log ends at line ${spec.lastRow.decision}`,
    spec.lastRow.question === null
      ? null
      : `resolved questions end at line ${spec.lastRow.question}`,
  ].filter((part) => part !== null);
  const next = [
    spec.next.decision === null ? null : `decision ${spec.next.decision}`,
    spec.next.question === null ? null : `question ${spec.next.question}`,
    spec.next.task === null ? null : `task ${spec.next.task}`,
  ].filter((part) => part !== null);
  return [
    `- README ${spec.readmePath}${rows.length === 0 ? '' : `: ${rows.join(', ')}`}`,
    ...(next.length === 0 ? [] : [`- Next free IDs: ${next.join(', ')}`]),
  ];
}

function commitSection(commit: ReviewCommit): string {
  const parts = [
    `Commit ${commit.sha.slice(0, 7)}:`,
    tagged('commit-message', '', commit.message),
    `Files changed:\n${commit.files.map((file) => `  ${file}`).join('\n')}`,
    ...commit.diffs.map((d) => tagged('diff', `path="${d.path}"`, d.diff)),
  ];
  return parts.join('\n\n');
}

function taskSection(task: ReviewTask): string {
  const heading = `### ${task.id}${task.title === null ? '' : ` ${task.title}`}`;
  const deviations = task.deviations.map((d) => `- ${formatDeviation(d).replace(/\n/g, '\n  ')}`);
  return [
    heading,
    `Deviations:\n${deviations.join('\n')}`,
    task.commit === null ? 'No commit (the task is not done).' : commitSection(task.commit),
    task.brief === null
      ? `Brief ${task.briefPath}: not included (missing or over the size budget) — read it.`
      : tagged('brief', `path="${task.briefPath}"`, task.brief),
  ].join('\n\n');
}

function specSection(spec: ReviewSpecContext): string {
  return [
    `## Spec ${spec.name} — ${spec.title}`,
    [...locationLines(spec), ...readmeLines(spec)].join('\n'),
    spec.decisions.length === 0
      ? null
      : `Decision log rows the deviations mention:\n\n${spec.decisions.join('\n')}`,
    spec.taskPrompt === null ? null : tagged('task-prompt', '', spec.taskPrompt),
    ...spec.tasks.map(taskSection),
  ]
    .filter((part) => part !== null)
    .join('\n\n');
}

export function renderContext(context: ReviewContext): string {
  return [
    '# Review context',
    'Gathered by specrun when this review started. It is complete for what it covers: do not re-read these files or commits — read further code or diffs only where a verdict depends on them.',
    context.config === null
      ? null
      : `specrun.config.json:\n\n${tagged('config', '', context.config)}`,
    ...context.specs.map(specSection),
  ]
    .filter((part) => part !== null)
    .join('\n\n');
}

export function buildReview(input: ReviewInput): ReviewPrompt {
  const instructions = input.instructions ?? readFileSync(REVIEW_PROMPT_PATH, 'utf8');
  return {
    systemPrompt: `${instructions.trimEnd()}\n\n---\n\n${renderContext(input.context)}\n`,
    message: [
      `Let's review these deviations together (\`${input.command}\`). The review context has the briefs, commits and decisions behind them.`,
      input.listing.trimEnd(),
    ].join('\n\n'),
  };
}
