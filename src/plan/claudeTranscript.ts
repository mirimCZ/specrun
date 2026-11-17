import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { z } from 'zod';
import type { PlanMetrics } from '../events/eventSchema.js';

/** `CLAUDE_CONFIG_DIR` when set, else `~/.claude` (PLD-7). */
export function claudeConfigDir(env: NodeJS.ProcessEnv, home: string): string {
  const fromEnv = env['CLAUDE_CONFIG_DIR'];
  return fromEnv !== undefined && fromEnv !== '' ? fromEnv : join(home, '.claude');
}

/** First `<configDir>/projects/*\/<sessionId>.jsonl`, or null when no project folder has it. */
export function findClaudeTranscript(sessionId: string, configDir: string): string | null {
  const projects = join(configDir, 'projects');
  if (!existsSync(projects)) return null;
  const folders = readdirSync(projects, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const folder of folders) {
    const file = join(projects, folder, `${sessionId}.jsonl`);
    if (existsSync(file)) return file;
  }
  return null;
}

const TokenCount = z.number().int().min(0).catch(0);

// Only what the metrics need; everything else on the line is ignored.
const AssistantLineSchema = z.object({
  type: z.literal('assistant'),
  isSidechain: z.boolean().optional(),
  message: z.object({
    id: z.string().min(1),
    model: z.string().optional(),
    usage: z.object({
      input_tokens: TokenCount.optional(),
      output_tokens: TokenCount.optional(),
      cache_read_input_tokens: TokenCount.optional(),
      cache_creation_input_tokens: TokenCount.optional(),
    }),
  }),
});

type Turn = {
  sidechain: boolean;
  model: string | null;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

/** Turns keyed by `message.id` in first-seen order; a later line of the same id replaces it. */
function readTurns(file: string): Map<string, Turn> {
  const turns = new Map<string, Turn>();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      // A half-written or foreign line must not cost the whole session its metrics.
      continue;
    }
    const parsed = AssistantLineSchema.safeParse(value);
    if (!parsed.success) continue;
    const { message, isSidechain } = parsed.data;
    turns.set(message.id, {
      sidechain: isSidechain === true,
      model: message.model ?? null,
      input: message.usage.input_tokens ?? 0,
      output: message.usage.output_tokens ?? 0,
      cacheRead: message.usage.cache_read_input_tokens ?? 0,
      cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
    });
  }
  return turns;
}

function subagentFiles(file: string): string[] {
  const dir = join(dirname(file), basename(file, '.jsonl'), 'subagents');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => join(dir, entry.name))
    .sort();
}

/** Token metrics of a Claude Code session: the main transcript plus its subagent files (PLD-7). */
export function readPlanMetrics(file: string): PlanMetrics {
  const metrics: PlanMetrics = {
    turns: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheRead: 0,
    cacheWrite: 0,
    peakContext: 0,
    models: [],
    subagents: { files: 0, turns: 0, inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0 },
  };
  const addSubagent = (turn: Turn): void => {
    const sub = metrics.subagents;
    sub.turns += 1;
    sub.inputTokens += turn.input;
    sub.outputTokens += turn.output;
    sub.cacheRead += turn.cacheRead;
    sub.cacheWrite += turn.cacheWrite;
  };

  for (const turn of readTurns(file).values()) {
    if (turn.sidechain) {
      addSubagent(turn);
      continue;
    }
    metrics.turns += 1;
    metrics.inputTokens += turn.input;
    metrics.outputTokens += turn.output;
    metrics.cacheRead += turn.cacheRead;
    metrics.cacheWrite += turn.cacheWrite;
    metrics.peakContext = Math.max(
      metrics.peakContext,
      turn.input + turn.cacheRead + turn.cacheWrite,
    );
    if (turn.model !== null && !metrics.models.includes(turn.model)) {
      metrics.models.push(turn.model);
    }
  }

  const files = subagentFiles(file);
  metrics.subagents.files = files.length;
  for (const subFile of files) {
    for (const turn of readTurns(subFile).values()) addSubagent(turn);
  }
  return metrics;
}
