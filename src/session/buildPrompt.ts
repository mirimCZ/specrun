import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CompleteTaskPayload, Deviation } from '../events/eventSchema.js';
import { formatQuestion } from '../events/formatQuestion.js';
import type { SpecState } from '../events/taskState.js';
import type { LoadedSpec } from '../spec/loadSpec.js';
import type { SpecTask } from '../spec/specSchema.js';

/** Next to the compiled module in `dist/session/` (copied by the build) and in `src/session/`. */
export const PROTOCOL_PATH = fileURLToPath(new URL('./protocol.md', import.meta.url));

const PART_SEPARATOR = '\n\n---\n\n';
const NO_NOTES = 'No notes recorded.';

export function loadProtocol(path: string = PROTOCOL_PATH): string {
  return readFileSync(path, 'utf8');
}

export interface PromptParts {
  protocol: number;
  spec: number;
  brief: number;
  deps: number;
}

export interface BuiltPrompt {
  text: string;
  /** Characters per part, recorded on `session.started`. */
  parts: PromptParts;
}

export interface BuildPromptInput {
  spec: LoadedSpec;
  task: SpecTask;
  state: SpecState;
  protocol: string;
}

function formatDeviation({ kind, decision, what, why, question }: Deviation): string {
  const head = decision === undefined ? '' : `${decision}: `;
  const line = `- [${kind}] ${head}${what} — ${why}`;
  return question === undefined ? line : `${line}\n  - ${formatQuestion(question)}`;
}

function dependencySection(id: string, completed: CompleteTaskPayload | null): string {
  const lines = [`## Implementation notes of ${id} (dependency)`, ''];
  const notes = completed?.notes ?? [];
  const deviations = completed?.deviations ?? [];
  if (notes.length === 0 && deviations.length === 0) lines.push(NO_NOTES);
  lines.push(...notes.map((note) => `- ${note}`));
  if (deviations.length > 0) {
    if (notes.length > 0) lines.push('');
    lines.push('Deviations:', '', ...deviations.map(formatDeviation));
  }
  return lines.join('\n');
}

/** Protocol + spec prompt (`{TASK}` replaced) + brief + one notes section per need, in order. */
export function buildPrompt({ spec, task, state, protocol }: BuildPromptInput): BuiltPrompt {
  const specPrompt =
    spec.taskPromptPath === null
      ? ''
      : readFileSync(spec.taskPromptPath, 'utf8').replaceAll('{TASK}', task.id).trim();
  const brief = readFileSync(spec.briefPath(task.id), 'utf8').trim();
  const deps = task.needs
    .map((id) => dependencySection(id, state.tasks.get(id)?.lastCompleted ?? null))
    .join('\n\n');
  const protocolText = protocol.trim();
  const sections = [protocolText, specPrompt, brief, deps];
  return {
    text: sections.filter((section) => section.length > 0).join(PART_SEPARATOR) + '\n',
    parts: {
      protocol: protocolText.length,
      spec: specPrompt.length,
      brief: brief.length,
      deps: deps.length,
    },
  };
}
