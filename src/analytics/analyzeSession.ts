import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { SessionMetrics } from './metricsSchema.js';
import { COMMON_FILES } from './readFirst.js';

export const DEFAULT_TEST_PATTERNS: readonly string[] = [
  'vitest',
  'npm test',
  'npm run test',
  'spec-verify',
  'tsc',
  'typecheck',
];

export interface AnalyzeOptions {
  /** Paths from the brief; `null` when the brief could not be read. */
  readFirst: readonly string[] | null;
  testPatterns?: readonly string[];
  /** First turn (1-based) counted as fix; default none. */
  fixFromTurn?: number;
}

const MAX_FILES = 30;
const MAX_BASH = 10;
const COMMAND_CHARS = 120;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null;
const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

type ToolUse = { id: string; name: string; input: unknown };
type Turn = { usage: Rec; tools: ToolUse[] };
type Counter = { calls: number; resultChars: number };

function resultChars(content: unknown): number {
  if (typeof content === 'string') return content.length;
  if (!Array.isArray(content)) return 0;
  let total = 0;
  for (const block of content) {
    if (isRec(block) && typeof block.text === 'string') total += block.text.length;
  }
  return total;
}

function relativize(path: string, cwd: string | null): string {
  if (cwd === null) return path;
  const base = cwd.endsWith('/') ? cwd : `${cwd}/`;
  return path.startsWith(base) ? path.slice(base.length) : path;
}

function isTestTurn(tools: readonly ToolUse[], patterns: readonly string[]): boolean {
  if (tools.length === 0) return false;
  return tools.every((tool) => {
    if (tool.name !== 'Bash' || !isRec(tool.input)) return false;
    const command = tool.input.command;
    return typeof command === 'string' && patterns.some((p) => command.includes(p));
  });
}

function bashCommand(tool: { name: string; input: unknown }): string | null {
  if (tool.name !== 'Bash' || !isRec(tool.input)) return null;
  const command = tool.input.command;
  return typeof command === 'string' ? command.slice(0, COMMAND_CHARS) : null;
}

/** Pure: the cost picture of one session segment from its SDK messages. */
export function analyzeSession(
  messages: readonly SDKMessage[],
  options: AnalyzeOptions,
): SessionMetrics {
  const patterns = options.testPatterns ?? DEFAULT_TEST_PATTERNS;
  const fixFrom = options.fixFromTurn ?? Number.POSITIVE_INFINITY;
  let cwd: string | null = null;
  // One turn per API message id: streamed blocks share it; the last usage is the final one.
  const turns = new Map<string, Turn>();
  const toolById = new Map<string, { name: string; input: unknown }>();
  const results: { id: string; chars: number }[] = [];

  for (const message of messages as readonly unknown[]) {
    if (!isRec(message)) continue;
    if (
      message.type === 'system' &&
      message.subtype === 'init' &&
      typeof message.cwd === 'string'
    ) {
      cwd ??= message.cwd;
      continue;
    }
    // Subagent traffic has its own context; it is not part of the main curve.
    if (message.parent_tool_use_id != null) continue;
    const body = message.message;
    if (!isRec(body)) continue;
    if (message.type === 'assistant' && typeof body.id === 'string') {
      const turn = turns.get(body.id) ?? { usage: {}, tools: [] };
      if (isRec(body.usage)) turn.usage = body.usage;
      if (Array.isArray(body.content)) {
        for (const block of body.content) {
          if (!isRec(block) || block.type !== 'tool_use' || typeof block.name !== 'string')
            continue;
          const id = typeof block.id === 'string' ? block.id : '';
          turn.tools.push({ id, name: block.name, input: block.input });
          toolById.set(id, { name: block.name, input: block.input });
        }
      }
      turns.set(body.id, turn);
    } else if (message.type === 'user' && Array.isArray(body.content)) {
      for (const block of body.content) {
        if (isRec(block) && block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
          results.push({ id: block.tool_use_id, chars: resultChars(block.content) });
        }
      }
    }
  }

  const toolStats = new Map<string, Counter>();
  const fileStats = new Map<string, { reads: number; edits: number; resultChars: number }>();
  const bashStats = new Map<string, { calls: number; outputChars: number }>();
  const readPaths = new Set<string>();
  let rereads = 0;

  const fileOf = (input: unknown): string | null =>
    isRec(input) && typeof input.file_path === 'string' ? relativize(input.file_path, cwd) : null;
  const fileEntry = (path: string): { reads: number; edits: number; resultChars: number } => {
    const entry = fileStats.get(path) ?? { reads: 0, edits: 0, resultChars: 0 };
    fileStats.set(path, entry);
    return entry;
  };

  for (const turn of turns.values()) {
    for (const tool of turn.tools) {
      const stat = toolStats.get(tool.name) ?? { calls: 0, resultChars: 0 };
      stat.calls += 1;
      toolStats.set(tool.name, stat);
      const path = fileOf(tool.input);
      if (tool.name === 'Read' && path !== null) {
        fileEntry(path).reads += 1;
        if (readPaths.has(path)) rereads += 1;
        readPaths.add(path);
      } else if (EDIT_TOOLS.has(tool.name) && path !== null) {
        fileEntry(path).edits += 1;
      }
      const command = bashCommand(tool);
      if (command !== null) {
        const entry = bashStats.get(command) ?? { calls: 0, outputChars: 0 };
        entry.calls += 1;
        bashStats.set(command, entry);
      }
    }
  }
  for (const result of results) {
    const tool = toolById.get(result.id);
    if (tool === undefined) continue;
    const stat = toolStats.get(tool.name);
    if (stat !== undefined) stat.resultChars += result.chars;
    const path = fileOf(tool.input);
    if (tool.name === 'Read' && path !== null) fileEntry(path).resultChars += result.chars;
    const command = bashCommand(tool);
    const entry = command === null ? undefined : bashStats.get(command);
    if (entry !== undefined) entry.outputChars += result.chars;
  }

  const turnList = [...turns.values()].map((turn, i) => {
    const cacheRead = num(turn.usage.cache_read_input_tokens);
    const cacheWrite = num(turn.usage.cache_creation_input_tokens);
    return {
      n: i + 1,
      context: num(turn.usage.input_tokens) + cacheRead + cacheWrite,
      cacheRead,
      cacheWrite,
      output: num(turn.usage.output_tokens),
      tools: turn.tools.map((t) => t.name),
      raw: turn,
    };
  });

  const firstEdit = turnList.findIndex((t) => t.raw.tools.some((x) => EDIT_TOOLS.has(x.name)));
  // Without any edit the whole segment was orientation.
  const firstEditN = firstEdit === -1 ? Number.POSITIVE_INFINITY : firstEdit + 1;
  const phases: SessionMetrics['phases'] = {
    orient: { turns: 0, tokens: 0 },
    implement: { turns: 0, tokens: 0 },
    test: { turns: 0, tokens: 0 },
    fix: { turns: 0, tokens: 0 },
  };
  for (const turn of turnList) {
    const phase =
      turn.n >= fixFrom
        ? 'fix'
        : turn.n < firstEditN
          ? 'orient'
          : isTestTurn(turn.raw.tools, patterns)
            ? 'test'
            : 'implement';
    phases[phase].turns += 1;
    phases[phase].tokens += turn.context + turn.output;
  }

  let brief: SessionMetrics['brief'] = null;
  const readFirst = options.readFirst;
  if (readFirst !== null) {
    const covers = (entry: string, path: string): boolean =>
      path === entry || path.startsWith(entry.endsWith('/') ? entry : `${entry}/`);
    const read = [...readPaths];
    brief = {
      readFirst: [...readFirst],
      read: readFirst.filter((entry) => read.some((p) => covers(entry, p))),
      unread: readFirst.filter((entry) => !read.some((p) => covers(entry, p))),
      extraReads: read.filter(
        (p) => !COMMON_FILES.includes(p) && !readFirst.some((entry) => covers(entry, p)),
      ),
    };
  }

  return {
    turns: turnList.map(({ raw: _raw, ...turn }) => turn),
    peakContext: Math.max(0, ...turnList.map((t) => t.context)),
    tools: [...toolStats]
      .map(([name, s]) => ({ name, ...s }))
      .sort((a, b) => b.resultChars - a.resultChars),
    files: [...fileStats]
      .map(([path, s]) => ({ path, ...s }))
      .sort((a, b) => b.resultChars - a.resultChars)
      .slice(0, MAX_FILES),
    rereads,
    bash: [...bashStats]
      .map(([command, s]) => ({ command, ...s }))
      .sort((a, b) => b.outputChars - a.outputChars)
      .slice(0, MAX_BASH),
    brief,
    phases,
    estimate: true,
  };
}
