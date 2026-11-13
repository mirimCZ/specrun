import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Config } from '../config/configSchema.js';
import { formatIssues } from '../config/loadConfig.js';
import { SpecrunError } from '../errors.js';
import { DeviationEntrySchema, TaskSampleSchema } from '../stats/jsonOutput.js';

export const ARCHIVE_DIR = 'archive';
export const HISTORY_FILE = 'history.json';

/** What `specrun stats` and `specrun deviations` keep seeing of a spec after `specrun archive`. */
export const HistorySchema = z.object({
  version: z.literal(1),
  spec: z.string().min(1),
  title: z.string(),
  archivedAt: z.iso.datetime({ offset: true }),
  /** HEAD before the archive commit: the full spec is in git there. */
  commit: z.string().min(1),
  samples: z.array(TaskSampleSchema),
  deviations: z.array(DeviationEntrySchema),
});
export type History = z.infer<typeof HistorySchema>;

export function archiveRoot(repoRoot: string, config: Config): string {
  return join(repoRoot, config.specsDir, ARCHIVE_DIR);
}

/** Every `<specsDir>/archive/<spec>/history.json`, sorted by spec name. */
export function readArchivedHistories(repoRoot: string, config: Config): History[] {
  const root = archiveRoot(repoRoot, config);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, HISTORY_FILE)))
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const path = join(root, name, HISTORY_FILE);
      let json: unknown;
      try {
        json = JSON.parse(readFileSync(path, 'utf8'));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new SpecrunError('spec-invalid', `${path} is not valid JSON`, [message]);
      }
      const parsed = HistorySchema.safeParse(json);
      if (!parsed.success) {
        throw new SpecrunError('spec-invalid', `${path} is invalid`, formatIssues(parsed.error));
      }
      return parsed.data;
    });
}
