import { z } from 'zod';

export type SizeName = 'S' | 'M' | 'L';

const TurnsSchema = z.tuple([z.number().int().nonnegative(), z.number().int().positive()]);

export const SizeSchema = z.strictObject({
  turns: TurnsSchema.refine(([min, max]) => min <= max, { message: 'min must be ≤ max' }),
  usd: z.number().positive(),
});
export type Size = z.infer<typeof SizeSchema>;

export const DEFAULT_SIZES: Readonly<Record<SizeName, Size>> = {
  S: { turns: [10, 25], usd: 0.6 },
  M: { turns: [20, 45], usd: 1.2 },
  L: { turns: [40, 70], usd: 2.5 },
};

/** Kept under one `specrun/` folder so the feature map never sits among the specs (`run --all`). */
export const DEFAULT_SPECS_DIR = 'specrun/specs';
export const DEFAULT_FEATURES_DIR = 'specrun/features';

const VerifyStepSchema = z.strictObject({
  name: z.string().min(1),
  command: z.string().min(1),
});

const ModelsSchema = z.strictObject({
  default: z.string().min(1).default('sonnet'),
  strong: z.string().min(1).default('opus'),
});

const LimitsSchema = z.strictObject({
  sessionMinLeft: z.number().min(0).max(100).default(15),
  weeklyMinLeft: z.number().min(0).max(100).default(5),
});

const SizesSchema = z.strictObject({
  S: SizeSchema.default(DEFAULT_SIZES.S),
  M: SizeSchema.default(DEFAULT_SIZES.M),
  L: SizeSchema.default(DEFAULT_SIZES.L),
});

// Nested objects use `prefault({})` so a partial override (e.g. only `models.strong`) keeps the
// remaining defaults.
export const ConfigSchema = z.strictObject({
  specsDir: z.string().min(1).default(DEFAULT_SPECS_DIR),
  /** Repo-relative feature map folder; when it doesn't exist every feature-map step is skipped. */
  featuresDir: z.string().min(1).default(DEFAULT_FEATURES_DIR),
  verify: z.array(VerifyStepSchema).min(1),
  setup: z.string().min(1).nullable().default(null),
  /** false: run in the main checkout on the spec branch (needs a clean tree, no setup). */
  worktree: z.boolean().default(true),
  /** Ignored files (e.g. `.env`) copied from the main checkout into a new worktree. */
  worktreeFiles: z.array(z.string().min(1)).default([]),
  models: ModelsSchema.prefault({}),
  maxTurns: z.number().int().positive().default(150),
  verifyFixRounds: z.number().int().nonnegative().default(2),
  limits: LimitsSchema.prefault({}),
  sizes: SizesSchema.prefault({}),
  transcriptsDir: z.string().min(1).default('~/.specrun/runs'),
  commitTrailers: z.array(z.string().min(1)).default([]),
});
export type Config = z.infer<typeof ConfigSchema>;
