import type { Options, Query, SDKMessage, query } from '@anthropic-ai/claude-agent-sdk';
import {
  SPECRUN_SERVER,
  createSpecrunTools,
  type SpecrunToolDefinition,
  type SpecrunTools,
} from '../../src/session/specrunTools.js';

/** A scripted SDK message, or a control step that changes how the fake stream behaves. */
export type FakeStep =
  | SDKMessage
  /** The iterator throws `error` (the SDK failing mid-stream). */
  | { control: 'throw'; error: Error }
  /** Blocks until `options.abortController` aborts, then throws an `AbortError` like the SDK. */
  | { control: 'wait-abort' }
  /** Blocks until `close()` is called, then ends the stream. */
  | { control: 'hang' };

export type FakeQueryOptions = {
  /** Response of the usage probe; an `Error` makes the probe reject. */
  usage?: unknown;
};

export type FakeQueryCall = {
  prompt: string | AsyncIterable<unknown>;
  options: Options;
};

export type FakeQuery = {
  /** Drop-in for the SDK's `query`; each call plays the next script. */
  query: typeof query;
  /** Drop-in for `createSpecrunTools`: lets the fake run specrun tool calls like the SDK does. */
  createTools: typeof createSpecrunTools;
  calls: FakeQueryCall[];
  /** Number of `close()` / `interrupt()` / usage probe calls over all queries. */
  closed: number;
  interrupted: number;
  usageCalls: number;
};

function abortError(): Error {
  const error = new Error('Claude Code process aborted by user');
  error.name = 'AbortError';
  return error;
}

function toolUses(message: SDKMessage): { name: string; input: unknown }[] {
  if (message.type !== 'assistant') return [];
  const uses: { name: string; input: unknown }[] = [];
  for (const block of message.message.content) {
    if (block.type === 'tool_use') uses.push({ name: block.name, input: block.input });
  }
  return uses;
}

/**
 * Plays `scripts[i]` for the i-th `query()` call. An assistant `tool_use` of a specrun tool runs
 * the handler created through `createTools` before the next step, as the SDK would.
 */
export function createFakeQuery(scripts: FakeStep[][], opts: FakeQueryOptions = {}): FakeQuery {
  let tools: SpecrunToolDefinition[] = [];
  const prefix = `mcp__${SPECRUN_SERVER}__`;

  const fake: FakeQuery = {
    calls: [],
    closed: 0,
    interrupted: 0,
    usageCalls: 0,
    createTools: (onCall): SpecrunTools => {
      const created = createSpecrunTools(onCall);
      tools = created.tools;
      return created;
    },
    query: ({ prompt, options = {} }) => {
      const steps = scripts[fake.calls.length] ?? [];
      fake.calls.push({ prompt, options });
      let release: () => void = () => {};
      const released = new Promise<void>((resolve) => (release = resolve));

      async function* play(): AsyncGenerator<SDKMessage, void> {
        for (const step of steps) {
          if ('control' in step) {
            if (step.control === 'throw') throw step.error;
            if (step.control === 'hang') {
              await released;
              return;
            }
            const signal = options.abortController?.signal;
            if (!signal) throw new Error('fakeQuery: wait-abort needs options.abortController');
            if (!signal.aborted) {
              await new Promise<void>((resolve) =>
                signal.addEventListener('abort', () => resolve(), { once: true }),
              );
            }
            throw abortError();
          }
          yield step;
          for (const use of toolUses(step)) {
            if (!use.name.startsWith(prefix)) continue;
            const definition = tools.find((t) => t.name === use.name.slice(prefix.length));
            await definition?.handler(use.input);
          }
        }
      }

      const generator = play();
      return Object.assign(generator, {
        interrupt: async () => {
          fake.interrupted += 1;
          return undefined;
        },
        close: () => {
          fake.closed += 1;
          release();
        },
        usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => {
          fake.usageCalls += 1;
          if (opts.usage instanceof Error) throw opts.usage;
          return opts.usage;
        },
      }) as unknown as Query;
    },
  };
  return fake;
}
