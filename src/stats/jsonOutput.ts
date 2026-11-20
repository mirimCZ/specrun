import { z } from 'zod';
import { DEVIATION_KINDS } from '../events/eventSchema.js';

/** SRD-16: the feedback skill reads these shapes; changing them means bumping `version`. */
const Generated = { version: z.literal(1), generatedAt: z.string() };

const Distribution = z.object({ sum: z.number(), p50: z.number(), p90: z.number() });
const Range = z.object({ turns: z.tuple([z.number(), z.number()]), usd: z.number() });
const Phase = z.object({ turns: z.number(), tokens: z.number() });

/** Also the shape `specrun archive` keeps in `history.json`. */
export const TaskSampleSchema = z.object({
  spec: z.string(),
  task: z.string(),
  model: z.string(),
  size: z.string(),
  turns: z.number(),
  costUsd: z.number(),
  peakContext: z.number(),
  sessions: z.number(),
  verifyRounds: z.number(),
  deviations: z.number(),
  budgetExceeded: z.boolean(),
});

/** PLD-8: planning totals of one spec, from its latest `plan.session` event per session. */
export const PlanningSummarySchema = z.object({
  sessions: z.number(),
  turns: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  peakContext: z.number(),
  subagentTokens: z.number(),
});
export type PlanningSummary = z.infer<typeof PlanningSummarySchema>;

/** Wall time of verify rounds or of one verify step, over all rounds of a spec. */
const TimingSchema = z.object({
  runs: z.number(),
  failed: z.number(),
  sumMs: z.number(),
  p50Ms: z.number(),
  p90Ms: z.number(),
  maxMs: z.number(),
});

/** Verify rounds of one spec (`verify.finished`); also kept in `history.json`. */
export const VerifySummarySchema = TimingSchema.extend({
  /** Agent session time, so verify's share of the task time can be told. */
  sessionMs: z.number(),
  /** In the order the steps first ran. */
  steps: z.array(TimingSchema.extend({ name: z.string() })),
});
export type VerifySummary = z.infer<typeof VerifySummarySchema>;

/** Segments (`session.finished`) one account ran in a spec (MAD-12). */
export const AccountSummarySchema = z.object({
  account: z.string(),
  segments: z.number(),
  turns: z.number(),
  costUsd: z.number(),
});
export type AccountSummary = z.infer<typeof AccountSummarySchema>;

export const DeviationEntrySchema = z.object({
  spec: z.string(),
  task: z.string(),
  kind: z.enum(DEVIATION_KINDS),
  decision: z.string().nullable(),
  what: z.string(),
  why: z.string(),
  question: z
    .object({ text: z.string(), options: z.array(z.string()), chosen: z.string() })
    .nullable(),
  // Defaulted: history.json files written before reviews were recorded lack it.
  reviewed: z.boolean().default(false),
});

export const StatsJsonSchema = z.object({
  ...Generated,
  specs: z.array(z.string()),
  /** Those of `specs` shelved without merging (SRD-35); their samples are included. */
  shelved: z.array(z.string()),
  by: z.enum(['task', 'model', 'size', 'spec']),
  samples: z.array(TaskSampleSchema),
  groups: z.array(
    z.object({
      key: z.string(),
      count: z.number(),
      turns: Distribution,
      costUsd: Distribution,
      peakContext: Distribution,
      budgetExceeded: z.number(),
    }),
  ),
  /** null unless `--calibrate`. */
  calibration: z
    .array(
      z.object({
        model: z.string(),
        size: z.string(),
        n: z.number(),
        current: Range.nullable(),
        suggestion: Range.nullable(),
      }),
    )
    .nullable(),
  /** Specs with planning data (PLD-8); additive, `version` stays 1. */
  planning: z.array(PlanningSummarySchema.extend({ spec: z.string() })),
  /** Specs with verify rounds; additive, `version` stays 1. */
  verify: z.array(VerifySummarySchema.extend({ spec: z.string() })),
  /** Per spec and account; additive, `version` stays 1. Archived specs contribute nothing. */
  accounts: z.array(AccountSummarySchema.extend({ spec: z.string() })),
});
export type StatsJson = z.infer<typeof StatsJsonSchema>;

export const DeviationsJsonSchema = z.object({
  ...Generated,
  deviations: z.array(DeviationEntrySchema),
  counts: z.record(z.string(), z.number()),
  /** Specs of `deviations` shelved without merging (SRD-35). */
  shelved: z.array(z.string()),
});
export type DeviationsJson = z.infer<typeof DeviationsJsonSchema>;

const AnalyzedTask = z.object({
  task: z.string(),
  segments: z.number(),
  peakContext: z.number(),
  topFiles: z.array(z.object({ path: z.string(), resultChars: z.number() })),
  rereads: z.number(),
  /** Read-first files never read; null when no segment had a brief. */
  unreadFirst: z.array(z.string()).nullable(),
  phases: z.object({ orient: Phase, implement: Phase, test: Phase, fix: Phase }),
  estimate: z.literal(true),
});

export const AnalyzeJsonSchema = z.object({
  ...Generated,
  specs: z.array(z.object({ spec: z.string(), tasks: z.array(AnalyzedTask) })),
  /** Number of events appended by `--reindex`; null without it. */
  reindexed: z.number().nullable(),
  warnings: z.array(z.string()),
});
export type AnalyzeJson = z.infer<typeof AnalyzeJsonSchema>;
