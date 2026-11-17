import { z } from 'zod';

const KEBAB = '[a-z0-9]+(?:-[a-z0-9]+)*';

/** One part of a feature id (`<area>` or `<name>`), kebab-case. */
export const FEATURE_ID_PART_PATTERN = new RegExp(`^${KEBAB}$`);

/** A feature id `<area>/<name>`, both parts kebab-case (FMD-1). */
export const FEATURE_ID_PATTERN = new RegExp(`^${KEBAB}/${KEBAB}$`);

const FeatureIdSchema = z.string().regex(FEATURE_ID_PATTERN, {
  message: 'feature id must be <area>/<name>, both kebab-case (e.g. board/fog-cells)',
});

/** Repo-relative file or folder; globs are not expanded, so they are rejected. */
const RepoPathSchema = z
  .string()
  .min(1)
  .refine((path) => !/[*?[\]{}]/.test(path), { message: 'paths are files or folders, no globs' });

export const FeatureFrontmatterSchema = z.strictObject({
  id: FeatureIdSchema,
  title: z.string().min(1),
  status: z.enum(['draft', 'verified']),
  depends_on: z.array(FeatureIdSchema).default([]),
  code: z.array(RepoPathSchema).min(1),
  tests: z.array(RepoPathSchema).default([]),
  specs: z.array(z.string().min(1)).default([]),
});
export type FeatureFrontmatter = z.infer<typeof FeatureFrontmatterSchema>;

/** Mermaid node id of a feature (FMD-3): `board/fog-cells` → `board_fog_cells`. */
export function nodeIdOf(id: string): string {
  return id.replace(/[/-]/g, '_');
}

/** `## ` sections every feature doc has, in this order (FMD-5). */
export const REQUIRED_SECTIONS = ['Purpose', 'Capabilities', 'Expectations'] as const;

/** `## ` sections a feature doc may add after the required ones, in this order (FMD-5). */
export const OPTIONAL_SECTIONS = ['Pitfalls', 'Out of scope'] as const;
