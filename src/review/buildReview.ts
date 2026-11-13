import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Next to the compiled module in `dist/review/` (copied by the build) and in `src/review/`. */
export const REVIEW_PROMPT_PATH = fileURLToPath(new URL('./reviewPrompt.md', import.meta.url));

/** Where a reviewed spec's files are; paths relative to the repo root, where Claude starts. */
export type ReviewSpec =
  | { kind: 'live'; name: string; files: string; worktree: string | null; branch: string }
  | { kind: 'archived'; name: string; files: string; commit: string; original: string };

export interface ReviewInput {
  /** The `specrun deviations …` command line the listing came from. */
  command: string;
  listing: string;
  specs: readonly ReviewSpec[];
  instructions?: string;
}

export interface ReviewPrompt {
  /** Appended to Claude Code's system prompt: how to review. */
  systemPrompt: string;
  /** The first user message: what to review, so the user sees it in the session too. */
  message: string;
}

function specLine(spec: ReviewSpec): string {
  if (spec.kind === 'archived') {
    return `- ${spec.name}: archived in ${spec.files} — full spec at commit ${spec.commit.slice(0, 7)} (${spec.original})`;
  }
  const where =
    spec.worktree === null
      ? 'no worktree'
      : `worktree ${spec.worktree} (the next run reads this copy)`;
  return `- ${spec.name}: ${spec.files} — branch ${spec.branch}, ${where}`;
}

export function buildReview(input: ReviewInput): ReviewPrompt {
  const systemPrompt = input.instructions ?? readFileSync(REVIEW_PROMPT_PATH, 'utf8');
  const message = [
    `Let's review these deviations together (\`${input.command}\`):`,
    input.listing.trimEnd(),
    `Spec files:\n${input.specs.map(specLine).join('\n')}`,
  ].join('\n\n');
  return { systemPrompt, message };
}
