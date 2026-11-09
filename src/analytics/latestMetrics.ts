import type { SpecrunEvent } from '../events/eventSchema.js';
import { SessionMetricsSchema, type SessionMetrics } from './metricsSchema.js';

export function metricsKey(task: string, sessionId: string, segment: number): string {
  return `${task}/${sessionId}/${segment}`;
}

/** The metrics of the highest `analyzerVersion` per segment (SRD-14); a later event wins a tie. */
export function latestMetrics(events: readonly SpecrunEvent[]): Map<string, SessionMetrics> {
  const best = new Map<string, { version: number; metrics: SessionMetrics }>();
  for (const event of events) {
    if (event.t !== 'analytics.session') continue;
    const parsed = SessionMetricsSchema.safeParse(event.metrics);
    if (!parsed.success) continue;
    const key = metricsKey(event.task, event.sessionId, event.segment);
    const current = best.get(key);
    if (current === undefined || event.analyzerVersion >= current.version) {
      best.set(key, { version: event.analyzerVersion, metrics: parsed.data });
    }
  }
  return new Map([...best].map(([key, value]) => [key, value.metrics]));
}
