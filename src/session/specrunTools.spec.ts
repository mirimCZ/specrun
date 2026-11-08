import { describe, expect, it } from 'vitest';
import type { CompleteTaskPayload } from '../events/eventSchema.js';
import {
  BLOCK_TASK_TOOL,
  COMPLETE_TASK_TOOL,
  RECORDED_REPLY,
  SPECRUN_SERVER,
  createSpecrunTools,
  type ToolCall,
} from './specrunTools.js';

function setup(): { calls: ToolCall[]; call: (name: string, args: unknown) => Promise<unknown> } {
  const calls: ToolCall[] = [];
  const { tools } = createSpecrunTools((recorded) => calls.push(recorded));
  return {
    calls,
    call: (name, args) => {
      const definition = tools.find((t) => t.name === name);
      if (definition === undefined) throw new Error(`no tool ${name}`);
      return definition.handler(args);
    },
  };
}

const PAYLOAD: CompleteTaskPayload = {
  summary: 'Did it.',
  commitMessage: 'feat(session): tools (SR-5)',
  notes: ['src/session/specrunTools.ts'],
  deviations: [{ kind: 'ambiguity', decision: 'X', what: 'chose X', why: 'simpler' }],
};

const recorded = { content: [{ type: 'text', text: RECORDED_REPLY }] };

describe('createSpecrunTools', () => {
  it('names the tools like the constants', () => {
    const { server, allowedTools, tools } = createSpecrunTools(() => {});
    expect(server.name).toBe(SPECRUN_SERVER);
    expect(server.type).toBe('sdk');
    const names = tools.map((t) => `mcp__${SPECRUN_SERVER}__${t.name}`);
    expect(names).toEqual([COMPLETE_TASK_TOOL, BLOCK_TASK_TOOL]);
    expect(allowedTools).toEqual([COMPLETE_TASK_TOOL, BLOCK_TASK_TOOL]);
  });

  it('records a complete_task call', async () => {
    const { calls, call } = setup();
    expect(await call('complete_task', PAYLOAD)).toEqual(recorded);
    expect(calls).toEqual([{ tool: 'complete_task', payload: PAYLOAD }]);
  });

  it('records a block_task call', async () => {
    const { calls, call } = setup();
    expect(await call('block_task', { reason: 'needs network', kind: 'forbidden' })).toEqual(
      recorded,
    );
    expect(calls).toEqual([{ tool: 'block_task', reason: 'needs network', kind: 'forbidden' }]);
  });

  it.each<{ name: string; tool: string; args: unknown; path: string }>([
    {
      name: 'more than 15 notes',
      tool: 'complete_task',
      args: { ...PAYLOAD, notes: Array.from({ length: 16 }, (_, i) => `n${i}`) },
      path: 'notes',
    },
    {
      name: 'an unknown deviation kind',
      tool: 'complete_task',
      args: { ...PAYLOAD, deviations: [{ kind: 'oops', what: 'w', why: 'y' }] },
      path: 'deviations.0.kind',
    },
    {
      name: 'a missing commit message',
      tool: 'complete_task',
      args: { summary: 's', notes: [], deviations: [] },
      path: 'commitMessage',
    },
    {
      name: 'an unknown block kind',
      tool: 'block_task',
      args: { reason: 'r', kind: 'bored' },
      path: 'kind',
    },
    {
      name: 'an empty block reason',
      tool: 'block_task',
      args: { reason: '', kind: 'other' },
      path: 'reason',
    },
  ])('rejects $name without recording', async ({ tool, args, path }) => {
    const { calls, call } = setup();
    const result = await call(tool, args);
    expect(result).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: expect.stringContaining(`${path}: `) }],
    });
    expect(calls).toEqual([]);
  });
});
