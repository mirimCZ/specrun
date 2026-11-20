import { describe, expect, it } from 'vitest';
import { DEFAULT_SIZES } from '../config/configSchema.js';
import type { SpecrunEvent } from '../events/eventSchema.js';
import {
  accountSummary,
  calibrate,
  groupStats,
  percentile,
  planningSummary,
  verifySummary,
  type TaskSample,
} from './aggregate.js';

const sample = (over: Partial<TaskSample>): TaskSample => ({
  spec: 'demo',
  task: 'D-1',
  model: 'default',
  size: 'S',
  turns: 10,
  costUsd: 0.5,
  peakContext: 50_000,
  sessions: 1,
  verifyRounds: 1,
  deviations: 0,
  budgetExceeded: false,
  ...over,
});

describe('percentile', () => {
  it('uses nearest rank', () => {
    const values = [5, 1, 4, 2, 3, 10, 9, 8, 7, 6];
    expect(percentile(values, 10)).toBe(1);
    expect(percentile(values, 50)).toBe(5);
    expect(percentile(values, 90)).toBe(9);
    expect(percentile(values, 100)).toBe(10);
    expect(percentile([], 50)).toBe(0);
  });
});

describe('groupStats', () => {
  const samples = [
    sample({ task: 'D-1', model: 'default', turns: 10 }),
    sample({ task: 'D-2', model: 'default', turns: 30, budgetExceeded: true }),
    sample({ task: 'D-3', model: 'strong', turns: 20, spec: 'other' }),
  ];

  it('groups by model with sums and percentiles', () => {
    const groups = groupStats(samples, 'model');
    expect(groups.map((g) => g.key)).toEqual(['default', 'strong']);
    expect(groups[0]).toMatchObject({ count: 2, budgetExceeded: 1 });
    expect(groups[0]?.turns).toEqual({ sum: 40, p50: 10, p90: 30 });
  });

  it('groups by task as spec/task and by spec', () => {
    expect(groupStats(samples, 'task').map((g) => g.key)).toEqual([
      'demo/D-1',
      'demo/D-2',
      'other/D-3',
    ]);
    expect(groupStats(samples, 'spec').map((g) => [g.key, g.count])).toEqual([
      ['demo', 2],
      ['other', 1],
    ]);
  });

  it('groups by size smallest first', () => {
    const sizes = ['L', 'XS', 'M'].map((size) => sample({ task: `A-${size}`, size }));
    expect(groupStats(sizes, 'size').map((g) => g.key)).toEqual(['XS', 'M', 'L']);
  });
});

describe('calibrate', () => {
  it('suggests nothing below three samples and p10–p90 / p90 from three', () => {
    const samples = [
      ...[10, 20, 30].map((turns, i) => sample({ task: `A-${i}`, turns, costUsd: i + 1 })),
      sample({ task: 'B-1', size: 'M' }),
      sample({ task: 'B-2', size: 'M' }),
    ];
    expect(calibrate(samples, DEFAULT_SIZES)).toEqual([
      {
        model: 'default',
        size: 'S',
        n: 3,
        current: DEFAULT_SIZES.S,
        suggestion: { turns: [10, 30], usd: 3 },
      },
      { model: 'default', size: 'M', n: 2, current: DEFAULT_SIZES.M, suggestion: null },
    ]);
  });

  it('lists sizes smallest first', () => {
    const sizes = ['XL', 'L', 'S', 'XS', 'M'].map((size) => sample({ task: `A-${size}`, size }));
    expect(calibrate(sizes, DEFAULT_SIZES).map((row) => row.size)).toEqual([
      'XS',
      'S',
      'M',
      'L',
      'XL',
    ]);
  });
});

describe('planningSummary', () => {
  const metrics = (over: Record<string, number>) => ({
    turns: 1,
    inputTokens: 10,
    outputTokens: 5,
    cacheRead: 100,
    cacheWrite: 1,
    peakContext: 1000,
    models: ['m'],
    subagents: { files: 1, turns: 1, inputTokens: 1, outputTokens: 2, cacheRead: 3, cacheWrite: 4 },
    ...over,
  });
  const event = (sessionId: string, m: ReturnType<typeof metrics> | null): SpecrunEvent =>
    ({
      v: 1,
      at: '2026-01-01T09:00:00.000Z',
      runId: 'r1',
      t: 'plan.session',
      sessionId,
      resumed: false,
      exitCode: 0,
      metrics: m,
    }) as SpecrunEvent;

  it('counts one session id once, with its later event', () => {
    const s = planningSummary([
      event('a', metrics({ turns: 2 })),
      event('a', metrics({ turns: 7 })),
    ]);
    expect(s).toMatchObject({ sessions: 1, turns: 7 });
  });

  it('sums sessions and takes the max peak context', () => {
    const s = planningSummary([
      event('a', metrics({ peakContext: 500 })),
      event('b', metrics({ peakContext: 900 })),
    ]);
    expect(s).toEqual({
      sessions: 2,
      turns: 2,
      inputTokens: 20,
      outputTokens: 10,
      cacheRead: 200,
      cacheWrite: 2,
      peakContext: 900,
      subagentTokens: 20,
    });
  });

  it('skips null metrics and returns null without events', () => {
    expect(planningSummary([event('a', null)])).toBeNull();
    expect(planningSummary([])).toBeNull();
  });
});

describe('verifySummary', () => {
  const base = { v: 1, at: '2026-01-01T09:00:00.000Z', runId: 'r1' };
  const round = (ok: boolean, steps: [string, boolean, number][]): SpecrunEvent =>
    ({
      ...base,
      t: 'verify.finished',
      task: 'D-1',
      round: 0,
      ok,
      durationMs: steps.reduce((sum, [, , ms]) => sum + ms, 0),
      steps: steps.map(([name, stepOk, durationMs]) => ({ name, ok: stepOk, durationMs })),
      log: 'verify.log',
    }) as SpecrunEvent;
  const session = (durationMs: number): SpecrunEvent =>
    ({
      ...base,
      t: 'session.finished',
      task: 'D-1',
      sessionId: 's1',
      segment: 0,
      outcome: 'completed',
      turns: 1,
      peakContext: 1,
      inputTokens: 1,
      outputTokens: 1,
      cacheRead: 1,
      cacheWrite: 1,
      costUsd: 0,
      durationMs,
    }) as SpecrunEvent;

  it('times rounds and steps, counting failures and steps a failure skipped', () => {
    const s = verifySummary([
      session(9000),
      round(false, [['typecheck', false, 1000]]),
      round(true, [
        ['typecheck', true, 3000],
        ['test', true, 5000],
      ]),
    ]);
    expect(s).toEqual({
      runs: 2,
      failed: 1,
      sumMs: 9000,
      p50Ms: 1000,
      p90Ms: 8000,
      maxMs: 8000,
      sessionMs: 9000,
      steps: [
        {
          name: 'typecheck',
          runs: 2,
          failed: 1,
          sumMs: 4000,
          p50Ms: 1000,
          p90Ms: 3000,
          maxMs: 3000,
        },
        { name: 'test', runs: 1, failed: 0, sumMs: 5000, p50Ms: 5000, p90Ms: 5000, maxMs: 5000 },
      ],
    });
  });

  it('returns null without verify rounds', () => {
    expect(verifySummary([session(1000)])).toBeNull();
  });
});

describe('accountSummary', () => {
  const finished = (account: string | undefined, turns: number, costUsd: number): SpecrunEvent =>
    ({
      v: 1,
      at: '2026-01-01T09:00:00.000Z',
      runId: 'r1',
      t: 'session.finished',
      task: 'D-1',
      sessionId: 's1',
      segment: 0,
      outcome: 'completed',
      turns,
      peakContext: 1,
      inputTokens: 1,
      outputTokens: 1,
      cacheRead: 1,
      cacheWrite: 1,
      costUsd,
      durationMs: 1,
      ...(account === undefined ? {} : { account }),
    }) as SpecrunEvent;

  it('sums per account in order of first appearance', () => {
    expect(
      accountSummary([
        finished('lorem', 2, 0.5),
        finished('ipsum', 3, 1),
        finished('lorem', 4, 0.25),
      ]),
    ).toEqual([
      { account: 'lorem', segments: 2, turns: 6, costUsd: 0.75 },
      { account: 'ipsum', segments: 1, turns: 3, costUsd: 1 },
    ]);
  });

  it('counts events without account as default', () => {
    expect(accountSummary([finished(undefined, 2, 0.5), finished('default', 1, 0.5)])).toEqual([
      { account: 'default', segments: 2, turns: 3, costUsd: 1 },
    ]);
  });

  it('is empty without session.finished', () => {
    expect(accountSummary([])).toEqual([]);
  });
});
