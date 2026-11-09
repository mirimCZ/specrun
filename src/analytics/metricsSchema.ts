import { z } from 'zod';

/** Bump when the computation changes; `analyze --reindex` then appends events with the new value. */
export const ANALYZER_VERSION = 1;

const PhaseSchema = z.object({ turns: z.number().int().min(0), tokens: z.number().min(0) });

export const SessionMetricsSchema = z.object({
  turns: z.array(
    z.object({
      n: z.number().int().min(1),
      /** input + cache read + cache write: what the turn paid for in context. */
      context: z.number().min(0),
      cacheRead: z.number().min(0),
      cacheWrite: z.number().min(0),
      output: z.number().min(0),
      tools: z.array(z.string()),
    }),
  ),
  peakContext: z.number().min(0),
  tools: z.array(z.object({ name: z.string(), calls: z.number(), resultChars: z.number() })),
  files: z.array(
    z.object({ path: z.string(), reads: z.number(), edits: z.number(), resultChars: z.number() }),
  ),
  rereads: z.number().int().min(0),
  bash: z.array(z.object({ command: z.string(), calls: z.number(), outputChars: z.number() })),
  brief: z
    .object({
      readFirst: z.array(z.string()),
      read: z.array(z.string()),
      unread: z.array(z.string()),
      extraReads: z.array(z.string()),
    })
    .nullable(),
  phases: z.object({
    orient: PhaseSchema,
    implement: PhaseSchema,
    test: PhaseSchema,
    fix: PhaseSchema,
  }),
  /** The phase split is a heuristic. */
  estimate: z.literal(true),
});

export type SessionMetrics = z.infer<typeof SessionMetricsSchema>;
