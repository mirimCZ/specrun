import { z } from 'zod';

export const EVENT_VERSION = 1;

// Plain (non-strict) objects: fields added by a newer specrun are stripped, not rejected.
const EVENT_BASE = {
  v: z.literal(EVENT_VERSION),
  at: z.iso.datetime({ offset: true }),
  runId: z.string().min(1),
};

const IsoOrNull = z.iso.datetime({ offset: true }).nullable();
const PercentLeft = z.number().min(0).max(100).nullable();
const Count = z.number().int().min(0);
const Segment = z.number().int().min(0);

export const DEVIATION_KINDS = [
  'spec-bug',
  'ambiguity',
  'constraint',
  'test-trap',
  'scope',
] as const;

/** The question the agent would have asked a human, the options it weighed and its pick. */
export const DeviationQuestionSchema = z
  .object({
    text: z.string().min(1),
    options: z.array(z.string().min(1)).min(2),
    chosen: z.string().min(1),
  })
  .refine((question) => question.options.includes(question.chosen), {
    message: 'chosen must be one of options',
    path: ['chosen'],
  });
export type DeviationQuestion = z.infer<typeof DeviationQuestionSchema>;

export const DeviationSchema = z.object({
  kind: z.enum(DEVIATION_KINDS),
  decision: z.string().optional(),
  what: z.string(),
  why: z.string(),
  question: DeviationQuestionSchema.optional(),
});
export type Deviation = z.infer<typeof DeviationSchema>;

export const CompleteTaskPayloadSchema = z.object({
  summary: z.string(),
  commitMessage: z.string(),
  notes: z.array(z.string()).max(15),
  deviations: z.array(DeviationSchema),
});
export type CompleteTaskPayload = z.infer<typeof CompleteTaskPayloadSchema>;

export const RunStartedSchema = z.object({
  ...EVENT_BASE,
  t: z.literal('run.started'),
  spec: z.string(),
  branch: z.string(),
  base: z.string(),
  version: z.string(),
  options: z.record(z.string(), z.unknown()),
});

export const RunFinishedSchema = z.object({
  ...EVENT_BASE,
  t: z.literal('run.finished'),
  // `stopped`: the user asked to stop after the current task (first Ctrl+C or `s`).
  reason: z.enum(['done', 'checkpoint', 'paused-weekly', 'failed', 'interrupted', 'stopped']),
  message: z.string().optional(),
});

export const UsageSnapshotEventSchema = z.object({
  ...EVENT_BASE,
  t: z.literal('usage.snapshot'),
  sessionLeft: PercentLeft,
  sessionResetsAt: IsoOrNull,
  weeklyLeft: PercentLeft,
  weeklyResetsAt: IsoOrNull,
  source: z.enum(['event', 'probe']),
});

export const LimitWaitSchema = z.object({
  ...EVENT_BASE,
  t: z.literal('limit.wait'),
  task: z.string().optional(),
  reason: z.enum(['session-low', 'limit-hit']),
  until: z.iso.datetime({ offset: true }),
});

export const SESSION_REASONS = [
  'start',
  'verify-fix',
  'limit-resume',
  'nudge',
  'crash-resume',
] as const;

export const SessionStartedSchema = z.object({
  ...EVENT_BASE,
  t: z.literal('session.started'),
  task: z.string(),
  sessionId: z.string().nullable(),
  segment: Segment,
  attempt: z.number().int().min(1),
  model: z.string(),
  reason: z.enum(SESSION_REASONS),
  prompt: z.object({ protocol: Count, spec: Count, brief: Count, deps: Count }),
});

export const SESSION_OUTCOMES = [
  'completed',
  'blocked',
  'no-call',
  'limit',
  'max-turns',
  'interrupted',
  'error',
] as const;

export const SessionFinishedSchema = z.object({
  ...EVENT_BASE,
  t: z.literal('session.finished'),
  task: z.string(),
  // null when the SDK failed before reporting a session id.
  sessionId: z.string().nullable(),
  segment: Segment,
  outcome: z.enum(SESSION_OUTCOMES),
  error: z.string().optional(),
  turns: Count,
  peakContext: Count,
  inputTokens: Count,
  outputTokens: Count,
  cacheRead: Count,
  cacheWrite: Count,
  costUsd: z.number().min(0),
  durationMs: z.number().min(0),
});

export const TaskCompletedSchema = z.object({
  ...EVENT_BASE,
  t: z.literal('task.completed'),
  task: z.string(),
  sessionId: z.string().nullable(),
  payload: CompleteTaskPayloadSchema,
});

export const VerifyFinishedSchema = z.object({
  ...EVENT_BASE,
  t: z.literal('verify.finished'),
  task: z.string(),
  round: Segment,
  ok: z.boolean(),
  durationMs: z.number().min(0),
  steps: z.array(z.object({ name: z.string(), ok: z.boolean(), durationMs: z.number().min(0) })),
  log: z.string(),
});

export const TaskCommittedSchema = z.object({
  ...EVENT_BASE,
  t: z.literal('task.committed'),
  task: z.string(),
  commit: z.string().min(1),
  filesChanged: Count,
  insertions: Count,
  deletions: Count,
});

export const TaskBlockedSchema = z.object({
  ...EVENT_BASE,
  t: z.literal('task.blocked'),
  task: z.string(),
  reason: z.string(),
  source: z.enum(['agent', 'verify', 'max-turns', 'protocol', 'error']),
  kind: z.string().optional(),
  parkedRef: z.string().optional(),
});

export const BudgetExceededSchema = z.object({
  ...EVENT_BASE,
  t: z.literal('budget.exceeded'),
  task: z.string(),
  size: z.string(),
  turns: Count,
  costUsd: z.number().min(0),
  limit: z.object({ turns: Count, usd: z.number().min(0) }),
});

export const ProtocolViolationSchema = z.object({
  ...EVENT_BASE,
  t: z.literal('protocol.violation'),
  task: z.string(),
  kind: z.literal('agent-commit'),
  detail: z.string(),
});

export const ManualStatusSchema = z.object({
  ...EVENT_BASE,
  t: z.literal('manual.status'),
  task: z.string(),
  status: z.enum(['todo', 'done', 'blocked']),
  reason: z.string(),
});

/** `specrun review` marks what the user went through, so later reviews skip it. */
export const DeviationsReviewedSchema = z.object({
  ...EVENT_BASE,
  t: z.literal('deviations.reviewed'),
  /** `id` = `deviationId`: the same deviation reported again keeps counting as reviewed. */
  deviations: z.array(z.object({ task: z.string(), id: z.string().min(1) })).min(1),
});

export const AnalyticsSessionSchema = z.object({
  ...EVENT_BASE,
  t: z.literal('analytics.session'),
  task: z.string(),
  sessionId: z.string(),
  segment: Segment,
  analyzerVersion: z.number().int().min(1),
  // Typed by the analytics module; the log only guarantees it is present.
  metrics: z.unknown(),
});

export const EventSchema = z.discriminatedUnion('t', [
  RunStartedSchema,
  RunFinishedSchema,
  UsageSnapshotEventSchema,
  LimitWaitSchema,
  SessionStartedSchema,
  SessionFinishedSchema,
  TaskCompletedSchema,
  VerifyFinishedSchema,
  TaskCommittedSchema,
  TaskBlockedSchema,
  BudgetExceededSchema,
  ProtocolViolationSchema,
  ManualStatusSchema,
  DeviationsReviewedSchema,
  AnalyticsSessionSchema,
]);
export type SpecrunEvent = z.infer<typeof EventSchema>;
export type EventType = SpecrunEvent['t'];
export type EventOf<T extends EventType> = Extract<SpecrunEvent, { t: T }>;

export const EVENT_TYPES: ReadonlySet<string> = new Set<EventType>(
  EventSchema.options.map((option) => option.shape.t.value),
);

type Stamp = 'v' | 'at' | 'runId';
/** What callers append; the store stamps `v`, `at` and `runId`. */
export type NewEvent = SpecrunEvent extends infer E
  ? E extends SpecrunEvent
    ? Omit<E, Stamp>
    : never
  : never;
