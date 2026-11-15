import type { Config } from '../config/configSchema.js';
import { SpecrunError } from '../errors.js';
import { DEVIATION_KINDS } from '../events/eventSchema.js';
import { formatQuestion } from '../events/formatQuestion.js';
import { deviationEntries, type DeviationEntry } from '../stats/aggregate.js';
import { loadRunHistory, type RunHistory } from './specInputs.js';

export interface DeviationSelection {
  history: RunHistory;
  /** Live specs first (in spec order), then archived ones. */
  entries: DeviationEntry[];
  counts: Record<string, number>;
}

function isKind(value: string): value is DeviationEntry['kind'] {
  return (DEVIATION_KINDS as readonly string[]).includes(value);
}

/**
 * What `deviations` and `review` show: the named specs (default all), archived included; those
 * an earlier `specrun review` marked only with `includeReviewed`.
 */
export function selectDeviations(
  repoRoot: string,
  config: Config,
  names: readonly string[],
  kind: string | undefined,
  includeReviewed: boolean,
): DeviationSelection {
  if (kind !== undefined && !isKind(kind)) {
    throw new SpecrunError('spec-invalid', `Invalid --kind "${kind}"`, [
      `expected one of: ${DEVIATION_KINDS.join(', ')}`,
    ]);
  }
  const history = loadRunHistory(repoRoot, config, names);
  const entries = [
    ...deviationEntries(history.inputs),
    ...history.archived.flatMap((h) => h.deviations),
  ].filter((e) => (kind === undefined || e.kind === kind) && (includeReviewed || !e.reviewed));
  const counts: Record<string, number> = {};
  for (const e of entries) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
  return { history, entries, counts };
}

function inline(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ').trim();
}

export function formatDeviation(e: DeviationEntry): string {
  const decision = e.decision === null ? '' : `${inline(e.decision)}: `;
  const reviewed = e.reviewed ? '(reviewed) ' : '';
  const line = `${e.spec}/${e.task} [${e.kind}] ${reviewed}${decision}${inline(e.what)} — ${inline(e.why)}`;
  return e.question === null ? line : `${line}\n  ${formatQuestion(e.question)}`;
}

/** Grouped by kind with counts; ends with a newline. */
export function formatListing(
  entries: readonly DeviationEntry[],
  counts: Record<string, number>,
): string {
  const sections = DEVIATION_KINDS.filter((kind) => (counts[kind] ?? 0) > 0).map((kind) => {
    const lines = entries
      .filter((e) => e.kind === kind)
      .map((e) => `  ${formatDeviation(e).replace(/\n/g, '\n  ')}`);
    return `${kind} (${counts[kind]})\n${lines.join('\n')}`;
  });
  return `${sections.join('\n\n')}\n`;
}
