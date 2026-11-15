import { createHash } from 'node:crypto';
import type { Size, SizeName } from '../config/configSchema.js';
import type { Deviation, SpecrunEvent } from '../events/eventSchema.js';
import type { SpecState } from '../events/taskState.js';
import type { Spec } from '../spec/specSchema.js';

/** SRD-11: fewer samples than this give no suggestion. */
export const MIN_CALIBRATION_SAMPLES = 3;

export interface SpecInput {
  name: string;
  spec: Spec;
  state: SpecState;
  events: readonly SpecrunEvent[];
}

export interface TaskSample {
  spec: string;
  task: string;
  model: string;
  size: string;
  turns: number;
  costUsd: number;
  peakContext: number;
  sessions: number;
  verifyRounds: number;
  deviations: number;
  budgetExceeded: boolean;
}

/** One sample per task that reached `done`: totals over all its segments. */
export function taskSamples(specs: readonly SpecInput[]): TaskSample[] {
  return specs.flatMap(({ name, spec, state, events }) =>
    spec.tasks.flatMap((task): TaskSample[] => {
      const s = state.tasks.get(task.id);
      if (s?.status !== 'done') return [];
      return [
        {
          spec: name,
          task: task.id,
          model: task.model,
          size: task.size,
          turns: s.totals.turns,
          costUsd: s.totals.costUsd,
          peakContext: s.totals.peakContext,
          sessions: s.totals.sessions,
          verifyRounds: events.filter((e) => e.t === 'verify.finished' && e.task === task.id)
            .length,
          deviations: s.lastCompleted?.deviations.length ?? 0,
          budgetExceeded: s.budgetExceeded,
        },
      ];
    }),
  );
}

export interface DeviationEntry {
  spec: string;
  task: string;
  kind: Deviation['kind'];
  decision: string | null;
  what: string;
  why: string;
  question: { text: string; options: string[]; chosen: string } | null;
  /** Marked by `specrun review` (a `deviations.reviewed` event, or history.json). */
  reviewed: boolean;
}

/**
 * Content, not position: a task done again that reports the same deviation stays reviewed, and
 * archived entries (history.json has no events) are matched the same way.
 */
export function deviationId(
  e: Pick<DeviationEntry, 'task' | 'kind' | 'decision' | 'what' | 'why'>,
): string {
  return createHash('sha256')
    .update(JSON.stringify([e.task, e.kind, e.decision, e.what, e.why]))
    .digest('hex')
    .slice(0, 12);
}

/** Deviations of done tasks and of blocked ones (their latest `task.completed`), in spec order. */
export function deviationEntries(specs: readonly SpecInput[]): DeviationEntry[] {
  return specs.flatMap(({ name, spec, state, events }) => {
    const reviewed = new Set<string>();
    for (const e of events) {
      if (e.t !== 'deviations.reviewed') continue;
      for (const d of e.deviations) reviewed.add(`${d.task}\0${d.id}`);
    }
    return spec.tasks.flatMap((task) => {
      const s = state.tasks.get(task.id);
      // Done tasks keep their payload in state; for blocked ones it is the latest task.completed.
      let deviations: Deviation[] = [];
      if (s?.status === 'done') {
        deviations = s.lastCompleted?.deviations ?? [];
      } else if (s?.status === 'blocked') {
        for (const e of events) {
          if (e.t === 'task.completed' && e.task === task.id) deviations = e.payload.deviations;
        }
      }
      return deviations.map((d) => {
        const entry = {
          spec: name,
          task: task.id,
          kind: d.kind,
          decision: d.decision ?? null,
          what: d.what,
          why: d.why,
          question: d.question ?? null,
        };
        return { ...entry, reviewed: reviewed.has(`${task.id}\0${deviationId(entry)}`) };
      });
    });
  });
}

/** Nearest-rank percentile, p in 0..100; 0 for no values. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1] ?? 0;
}

export type GroupDimension = 'task' | 'model' | 'size' | 'spec';

export interface Distribution {
  sum: number;
  p50: number;
  p90: number;
}

export interface GroupStats {
  key: string;
  count: number;
  turns: Distribution;
  costUsd: Distribution;
  peakContext: Distribution;
  budgetExceeded: number;
}

function distribution(values: number[]): Distribution {
  return {
    sum: values.reduce((a, b) => a + b, 0),
    p50: percentile(values, 50),
    p90: percentile(values, 90),
  };
}

function keyOf(sample: TaskSample, by: GroupDimension): string {
  return by === 'task' ? `${sample.spec}/${sample.task}` : sample[by];
}

export function groupStats(samples: readonly TaskSample[], by: GroupDimension): GroupStats[] {
  const groups = new Map<string, TaskSample[]>();
  for (const sample of samples) {
    const key = keyOf(sample, by);
    groups.set(key, [...(groups.get(key) ?? []), sample]);
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, items]) => ({
      key,
      count: items.length,
      turns: distribution(items.map((i) => i.turns)),
      costUsd: distribution(items.map((i) => i.costUsd)),
      peakContext: distribution(items.map((i) => i.peakContext)),
      budgetExceeded: items.filter((i) => i.budgetExceeded).length,
    }));
}

export interface CalibrationRow {
  model: string;
  size: string;
  n: number;
  current: Size | null;
  /** null while `n` is below the minimum. */
  suggestion: { turns: [number, number]; usd: number } | null;
}

export function calibrate(
  samples: readonly TaskSample[],
  sizes: Readonly<Record<SizeName, Size>>,
): CalibrationRow[] {
  const groups = new Map<string, TaskSample[]>();
  for (const sample of samples) {
    const key = `${sample.model}|${sample.size}`;
    groups.set(key, [...(groups.get(key) ?? []), sample]);
  }
  return [...groups.values()]
    .map((items): CalibrationRow => {
      const first = items[0] as TaskSample;
      const turns = items.map((i) => i.turns);
      return {
        model: first.model,
        size: first.size,
        n: items.length,
        current: (sizes as Record<string, Size | undefined>)[first.size] ?? null,
        suggestion:
          items.length < MIN_CALIBRATION_SAMPLES
            ? null
            : {
                turns: [percentile(turns, 10), percentile(turns, 90)],
                usd: percentile(
                  items.map((i) => i.costUsd),
                  90,
                ),
              },
      };
    })
    .sort((a, b) => a.model.localeCompare(b.model) || a.size.localeCompare(b.size));
}
