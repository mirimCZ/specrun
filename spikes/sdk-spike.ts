// Spike: verifies what specrun needs from the Claude Agent SDK before the architecture is fixed.
//   1. auth through the Claude subscription (no API key)
//   2. an in-process custom tool (complete_task) with a validated, structured payload
//   3. rate_limit_event messages and the plan usage windows (5h / 7d)
//   4. per-turn usage on assistant messages (context curve) and totals on the result
//   5. resuming the session by id with its context intact
// Every message is written to spikes/out/<run>.jsonl; a summary is printed at the end.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createSdkMcpServer,
  query,
  tool,
  type Options,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

const OUT = join(import.meta.dirname, 'out');
mkdirSync(OUT, { recursive: true });

const workdir = mkdtempSync(join(tmpdir(), 'specrun-spike-'));
execFileSync('git', ['init', '-q'], { cwd: workdir });
writeFileSync(join(workdir, 'README.md'), '# Spike workspace\n');

const reported: unknown[] = [];

const completeTask = tool(
  'complete_task',
  'Call once when the task is finished. The runner verifies and commits your changes.',
  {
    summary: z.string().min(1).describe('One sentence: what was done'),
    commitMessage: z.string().min(1).describe('Conventional Commit subject'),
    notes: z.array(z.string()).describe('Implementation notes for dependent tasks'),
    deviations: z
      .array(
        z.object({
          kind: z.enum(['spec-bug', 'ambiguity', 'constraint', 'test-trap', 'scope']),
          decision: z.string().optional(),
          what: z.string(),
          why: z.string(),
        }),
      )
      .describe('Every place where you deviated from the brief'),
  },
  async (args) => {
    reported.push(args);
    return { content: [{ type: 'text', text: 'Recorded. Stop now.' }] };
  },
);

const server = createSdkMcpServer({ name: 'specrun', version: '0.0.0', tools: [completeTask] });

const baseOptions: Options = {
  cwd: workdir,
  model: 'haiku',
  maxTurns: 10,
  tools: ['Read', 'Write', 'Bash'],
  allowedTools: ['Read', 'Write', 'Bash', 'mcp__specrun__complete_task'],
  permissionMode: 'dontAsk',
  settingSources: [],
  mcpServers: { specrun: server },
};

type Summary = {
  run: string;
  apiKeySource?: string;
  model?: string;
  tools?: string[];
  sessionId?: string;
  rateLimitEvents: unknown[];
  usageProbe?: unknown;
  turns: { input: number; cacheRead: number; cacheWrite: number; output: number }[];
  result?: Record<string, unknown>;
  messageTypes: Record<string, number>;
};

async function run(name: string, prompt: string, options: Options): Promise<Summary> {
  const file = join(OUT, `${name}.jsonl`);
  writeFileSync(file, '');
  const summary: Summary = { run: name, rateLimitEvents: [], turns: [], messageTypes: {} };
  const q = query({ prompt, options });
  for await (const message of q as AsyncIterable<SDKMessage>) {
    appendFileSync(file, JSON.stringify(message) + '\n');
    const key = 'subtype' in message ? `${message.type}:${String(message.subtype)}` : message.type;
    summary.messageTypes[key] = (summary.messageTypes[key] ?? 0) + 1;
    if (message.type === 'system' && message.subtype === 'init') {
      summary.apiKeySource = message.apiKeySource;
      summary.model = message.model;
      summary.tools = message.tools;
      summary.sessionId = message.session_id;
      try {
        summary.usageProbe = await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({
          skipBehaviors: true,
        });
      } catch (error) {
        summary.usageProbe = `failed: ${String(error)}`;
      }
    } else if (message.type === 'rate_limit_event') {
      summary.rateLimitEvents.push(message.rate_limit_info);
    } else if (message.type === 'assistant') {
      const u = message.message.usage;
      summary.turns.push({
        input: u.input_tokens,
        cacheRead: u.cache_read_input_tokens ?? 0,
        cacheWrite: u.cache_creation_input_tokens ?? 0,
        output: u.output_tokens,
      });
    } else if (message.type === 'result') {
      summary.result = {
        subtype: message.subtype,
        is_error: message.is_error,
        num_turns: message.num_turns,
        total_cost_usd: message.total_cost_usd,
        modelUsage: message.modelUsage,
        session_id: message.session_id,
      };
    }
  }
  return summary;
}

console.log(`ANTHROPIC_API_KEY set: ${Boolean(process.env['ANTHROPIC_API_KEY'])}`);
console.log(`workdir: ${workdir}`);

const first = await run(
  'run1',
  [
    'You are testing a task runner. Do exactly this:',
    '1. Write the file hello.txt containing the single line "hi".',
    '2. Call the complete_task tool with a short summary, a commit message',
    '   "chore: add hello", one note naming the file, and one deviation of kind "scope"',
    '   saying you skipped adding a newline at the end (make one up if needed).',
    'Do not commit anything yourself.',
  ].join('\n'),
  baseOptions,
);

const second = first.sessionId
  ? await run(
      'run2-resume',
      'What exact commit message did you pass to complete_task? Reply with it only.',
      { ...baseOptions, resume: first.sessionId },
    )
  : undefined;

const report = { first, second, reported };
writeFileSync(join(OUT, 'summary.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
