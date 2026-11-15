import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { archiveRoot, HISTORY_FILE, type History } from '../archive/history.js';
import { activeSpecFiles } from '../cli/cliDeps.js';
import type { Config } from '../config/configSchema.js';
import { createEventStore } from '../events/eventStore.js';
import { deviationId, type DeviationEntry } from '../stats/aggregate.js';

export interface MarkReviewedInput {
  repoRoot: string;
  config: Config;
  /** Those of `selectDeviations`; archived ones are the objects of `archived`. */
  entries: readonly DeviationEntry[];
  archived: readonly History[];
  now: () => Date;
}

/**
 * Live specs get a `deviations.reviewed` event (in the worktree copy, like the run's events);
 * archived specs have no log, so their history.json is rewritten. Returns the files written.
 */
export function markReviewed(input: MarkReviewedInput): string[] {
  const { repoRoot, config, now } = input;
  const pending = new Set(input.entries.filter((e) => !e.reviewed));
  const written: string[] = [];

  for (const history of input.archived) {
    if (!history.deviations.some((d) => pending.has(d))) continue;
    const updated: History = {
      ...history,
      deviations: history.deviations.map((d) => (pending.has(d) ? { ...d, reviewed: true } : d)),
    };
    for (const d of history.deviations) pending.delete(d);
    const file = join(archiveRoot(repoRoot, config), history.spec, HISTORY_FILE);
    writeFileSync(file, `${JSON.stringify(updated, null, 2)}\n`);
    written.push(file);
  }

  const bySpec = new Map<string, DeviationEntry[]>();
  for (const e of pending) bySpec.set(e.spec, [...(bySpec.get(e.spec) ?? []), e]);
  for (const [spec, entries] of bySpec) {
    const file = activeSpecFiles(repoRoot, config, spec).eventsFile;
    createEventStore({ file, runId: `review-${randomUUID()}`, clock: { now } }).append({
      t: 'deviations.reviewed',
      deviations: entries.map((e) => ({ task: e.task, id: deviationId(e) })),
    });
    written.push(file);
  }
  return written;
}
