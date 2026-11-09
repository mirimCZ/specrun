import { describe, expect, it } from 'vitest';
import { assistantMessage } from '../../test/fixtures/sdkMessages.js';
import type { SpecrunEvent } from '../events/eventSchema.js';
import { analyzeSession } from './analyzeSession.js';
import { latestMetrics, metricsKey } from './latestMetrics.js';

function event(analyzerVersion: number, metrics: unknown, segment = 0): SpecrunEvent {
  return {
    v: 1,
    at: '2026-11-09T10:00:00.000Z',
    runId: 'r',
    t: 'analytics.session',
    task: 'A-1',
    sessionId: 's',
    segment,
    analyzerVersion,
    metrics,
  } as SpecrunEvent;
}

describe('latestMetrics', () => {
  const old = analyzeSession([], { readFirst: null });
  const fresh = analyzeSession([assistantMessage({ usage: { input: 5 } })], { readFirst: null });

  it('takes the highest analyzerVersion per segment, regardless of order', () => {
    const result = latestMetrics([event(2, fresh), event(1, old), event(1, old, 1)]);
    expect(result.get(metricsKey('A-1', 's', 0))).toEqual(fresh);
    expect(result.get(metricsKey('A-1', 's', 1))).toEqual(old);
  });

  it('ignores events whose metrics do not parse', () => {
    expect(latestMetrics([event(3, { nope: true })]).size).toBe(0);
  });
});
