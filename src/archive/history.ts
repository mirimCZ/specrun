import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Config } from '../config/configSchema.js';
import { formatIssues } from '../config/loadConfig.js';
import { SpecrunError } from '../errors.js';
import {
  DeviationEntrySchema,
  PlanningSummarySchema,
  TaskSampleSchema,
} from '../stats/jsonOutput.js';

export const ARCHIVE_DIR = 'archive';
export const HISTORY_FILE = 'history.json';

const ShelvedFields = {
  shelvedAt: z.iso.datetime({ offset: true }),
  reason: z.string(),
};

/** SRD-35 / SRD-36: whether the spec's work reached the main branch. */
export const OutcomeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('merged'),
    /** Set when `specrun unshelve` merged a shelved spec. */
    shelved: z.object(ShelvedFields).nullable(),
  }),
  z.object({
    kind: z.literal('shelved'),
    ...ShelvedFields,
    branch: z.string().min(1),
    /** Null after `--no-push`: the branch exists only locally. */
    remote: z.string().nullable(),
    /** The branch's commit when it was shelved. */
    tip: z.string().min(1),
  }),
]);
export type Outcome = z.infer<typeof OutcomeSchema>;

/** What `specrun stats` and `specrun deviations` keep seeing of a spec after `specrun archive`. */
export const HistorySchema = z.object({
  version: z.literal(1),
  spec: z.string().min(1),
  title: z.string(),
  archivedAt: z.iso.datetime({ offset: true }),
  /** HEAD before the archive commit: the full spec is in git there. */
  commit: z.string().min(1),
  // Defaulted: history.json files written before shelving existed were all merged.
  outcome: OutcomeSchema.default({ kind: 'merged', shelved: null }),
  // Defaulted: additive (PLD-8); older history.json files have no planning data.
  planning: PlanningSummarySchema.nullable().default(null),
  samples: z.array(TaskSampleSchema),
  deviations: z.array(DeviationEntrySchema),
});
export type History = z.infer<typeof HistorySchema>;
export type ShelvedHistory = History & { outcome: Extract<Outcome, { kind: 'shelved' }> };

export function archiveRoot(repoRoot: string, config: Config): string {
  return join(repoRoot, config.specsDir, ARCHIVE_DIR);
}

/** `<specsDir>/archive/<spec>/history.json`; null when the spec has none. */
export function readArchivedHistory(
  repoRoot: string,
  config: Config,
  spec: string,
): History | null {
  const path = join(archiveRoot(repoRoot, config), spec, HISTORY_FILE);
  if (!existsSync(path)) return null;
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
}

/** Every `<specsDir>/archive/<spec>/history.json`, sorted by spec name. */
export function readArchivedHistories(repoRoot: string, config: Config): History[] {
  const root = archiveRoot(repoRoot, config);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, HISTORY_FILE)))
    .map((entry) => entry.name)
    .sort()
    .flatMap((name) => readArchivedHistory(repoRoot, config, name) ?? []);
}

export function isShelved(history: History | null): history is ShelvedHistory {
  return history?.outcome.kind === 'shelved';
}

/** For commands that need the spec live (close, archive): point at unshelve instead. */
export function refuseShelved(repoRoot: string, config: Config, spec: string): void {
  const history = readArchivedHistory(repoRoot, config, spec);
  if (!isShelved(history)) return;
  const { shelvedAt, reason, branch } = history.outcome;
  throw new SpecrunError(
    'spec-invalid',
    `Spec "${spec}" is shelved since ${shelvedAt.slice(0, 10)} — ${branch} is not merged`,
    [`reason: ${reason}`, `specrun unshelve ${spec} merges it`],
  );
}
