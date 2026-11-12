import { z } from 'zod';
import { DEVIATION_KINDS } from '../events/eventSchema.js';

/** SRD-16: the feedback skill reads these shapes; changing them means bumping `version`. */
const Generated = { version: z.literal(1), generatedAt: z.string() };

const Distribution = z.object({ sum: z.number(), p50: z.number(), p90: z.number() });
const Range = z.object({ turns: z.tuple([z.number(), z.number()]), usd: z.number() });
const Phase = z.object({ turns: z.number(), tokens: z.number() });

export const StatsJsonSchema = z.object({
  ...Generated,
  specs: z.array(z.string()),
  by: z.enum(['task', 'model', 'size', 'spec']),
  samples: z.array(
    z.object({
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
    }),
  ),
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
});
export type StatsJson = z.infer<typeof StatsJsonSchema>;

export const DeviationsJsonSchema = z.object({
  ...Generated,
  deviations: z.array(
    z.object({
      spec: z.string(),
      task: z.string(),
      kind: z.enum(DEVIATION_KINDS),
      decision: z.string().nullable(),
      what: z.string(),
      why: z.string(),
      question: z
        .object({ text: z.string(), options: z.array(z.string()), chosen: z.string() })
        .nullable(),
    }),
  ),
  counts: z.record(z.string(), z.number()),
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
