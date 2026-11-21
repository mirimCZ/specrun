import { z } from 'zod';

/** Smallest to largest; stats list sizes in this order. */
export const SIZE_NAMES = ['XS', 'S', 'M', 'L', 'XL'] as const;
export type SizeName = (typeof SIZE_NAMES)[number];

const TurnsSchema = z.tuple([z.number().int().nonnegative(), z.number().int().positive()]);

export const SizeSchema = z.strictObject({
  turns: TurnsSchema.refine(([min, max]) => min <= max, { message: 'min must be ≤ max' }),
  usd: z.number().positive(),
});
export type Size = z.infer<typeof SizeSchema>;

export const DEFAULT_SIZES: Readonly<Record<SizeName, Size>> = {
  XS: { turns: [5, 15], usd: 0.3 },
  S: { turns: [10, 25], usd: 0.6 },
  M: { turns: [20, 45], usd: 1.2 },
  L: { turns: [40, 70], usd: 2.5 },
  XL: { turns: [60, 110], usd: 4.5 },
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

const PercentSchema = z.number().min(0).max(100);

/** Per-account override of the limits; unset fields fall back to the next level (MAD-3). */
export const AccountLimitsSchema = z.strictObject({
  sessionMinLeft: PercentSchema.optional(),
  weeklyMinLeft: PercentSchema.optional(),
});

/** The limits of one account after merging every level. */
export type AccountLimits = { sessionMinLeft: number; weeklyMinLeft: number };

const LimitsSchema = z.strictObject({
  sessionMinLeft: PercentSchema.default(15),
  weeklyMinLeft: PercentSchema.default(5),
  /** Account name → override; names come from `~/.specrun/config.json`. */
  accounts: z.record(z.string(), AccountLimitsSchema).default({}),
});

const SizesSchema = z.strictObject({
  XS: SizeSchema.default(DEFAULT_SIZES.XS),
  S: SizeSchema.default(DEFAULT_SIZES.S),
  M: SizeSchema.default(DEFAULT_SIZES.M),
  L: SizeSchema.default(DEFAULT_SIZES.L),
  XL: SizeSchema.default(DEFAULT_SIZES.XL),
});

const ClockTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'expected a time as HH:MM' });

/** Local time; `from` after `to` spans midnight. */
const SilentWindowSchema = z.strictObject({ from: ClockTimeSchema, to: ClockTimeSchema });

// Nested objects use `prefault({})` so a partial override (e.g. only `models.strong`) keeps the
// remaining defaults.
export const ConfigSchema = z.strictObject({
  specsDir: z.string().min(1).default(DEFAULT_SPECS_DIR),
  /** Repo-relative feature map folder; when it doesn't exist every feature-map step is skipped. */
  featuresDir: z.string().min(1).default(DEFAULT_FEATURES_DIR),
  verify: z.array(VerifyStepSchema).min(1),
  /** Extra steps (e.g. the full test suite) after the spec's last task and after a merge. */
  verifyFinal: z.array(VerifyStepSchema).default([]),
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
  /** Repeat a sound when a run ends until a key is pressed; `run --chime` / `--no-chime` win. */
  chimeOnFinish: z.boolean().default(false),
  /** No chime when a run ends in this window; null: always. */
  chimeSilentBetween: SilentWindowSchema.nullable().default({ from: '00:00', to: '08:00' }),
});
export type Config = z.infer<typeof ConfigSchema>;
