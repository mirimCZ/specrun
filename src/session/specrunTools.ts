import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { CompleteTaskPayloadSchema, type CompleteTaskPayload } from '../events/eventSchema.js';

export const SPECRUN_SERVER = 'specrun';
export const COMPLETE_TASK_TOOL = 'mcp__specrun__complete_task';
export const BLOCK_TASK_TOOL = 'mcp__specrun__block_task';

export const BLOCK_KINDS = ['impossible', 'test', 'forbidden', 'other'] as const;

export const BlockTaskInputSchema = z.object({
  reason: z.string().min(1).describe('The exact reason the task cannot be finished'),
  kind: z.enum(BLOCK_KINDS).describe('impossible · test · forbidden · other'),
});
export type BlockTaskInput = z.infer<typeof BlockTaskInputSchema>;

export type ToolCall =
  | { tool: 'complete_task'; payload: CompleteTaskPayload }
  | { tool: 'block_task'; reason: string; kind: BlockTaskInput['kind'] };

export const RECORDED_REPLY = 'Recorded — end your turn now.';

// The event schema stays the single definition of the payload; only descriptions for the
// model are added here (`describe` keeps the validation of the field it wraps).
const { summary, commitMessage, notes, deviations } = CompleteTaskPayloadSchema.shape;
const COMPLETE_TASK_SHAPE = {
  summary: summary.describe('One sentence: what was done'),
  commitMessage: commitMessage.describe('Conventional Commit subject; the runner commits with it'),
  notes: notes.describe(
    'At most 15 implementation notes for dependent tasks: files, exported names, signatures',
  ),
  deviations: deviations.describe(
    'Every deviation from the brief; kind: spec-bug · ambiguity · constraint · test-trap · scope',
  ),
};

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

function reply(text: string, isError = false): ToolResult {
  return isError
    ? { content: [{ type: 'text', text }], isError }
    : { content: [{ type: 'text', text }] };
}

function invalid(error: z.ZodError): ToolResult {
  const issues = error.issues.map(
    (issue) => `${issue.path.join('.') || '(input)'}: ${issue.message}`,
  );
  return reply(`Invalid input, nothing recorded — fix and call again:\n${issues.join('\n')}`, true);
}

/** What the specrun server registers; exposed because the SDK server hides its tool list. */
export interface SpecrunToolDefinition {
  name: 'complete_task' | 'block_task';
  description: string;
  /** Takes untrusted input: validates it before `onCall` sees it. */
  handler: (args: unknown) => Promise<ToolResult>;
}

export interface SpecrunTools {
  server: McpSdkServerConfigWithInstance;
  allowedTools: string[];
  tools: SpecrunToolDefinition[];
}

/** The `specrun` MCP server; `onCall` receives every valid call, invalid input is rejected. */
export function createSpecrunTools(onCall: (call: ToolCall) => void): SpecrunTools {
  // Handlers re-validate: the SDK's inferred args don't model optional fields exactly
  // (`exactOptionalPropertyTypes`), and a parse keeps the recorded call typed by the schema.
  const completeTask: SpecrunToolDefinition = {
    name: 'complete_task',
    description:
      'Call once when the task is implemented and your checks pass. The runner verifies and commits.',
    handler: async (args) => {
      const parsed = CompleteTaskPayloadSchema.safeParse(args);
      if (!parsed.success) return invalid(parsed.error);
      onCall({ tool: 'complete_task', payload: parsed.data });
      return reply(RECORDED_REPLY);
    },
  };
  const blockTask: SpecrunToolDefinition = {
    name: 'block_task',
    description:
      'Call when the task cannot be finished. Revert nothing: the runner parks the work.',
    handler: async (args) => {
      const parsed = BlockTaskInputSchema.safeParse(args);
      if (!parsed.success) return invalid(parsed.error);
      onCall({ tool: 'block_task', reason: parsed.data.reason, kind: parsed.data.kind });
      return reply(RECORDED_REPLY);
    },
  };
  const sdkTools = [
    tool(completeTask.name, completeTask.description, COMPLETE_TASK_SHAPE, completeTask.handler),
    tool(blockTask.name, blockTask.description, BlockTaskInputSchema.shape, blockTask.handler),
  ];
  return {
    server: createSdkMcpServer({ name: SPECRUN_SERVER, version: '1.0.0', tools: sdkTools }),
    allowedTools: [COMPLETE_TASK_TOOL, BLOCK_TASK_TOOL],
    tools: [completeTask, blockTask],
  };
}
