import { describe, expect, it } from 'vitest';
import { DEFAULT_SIZES } from '../config/configSchema.js';
import { calibrate, groupStats, percentile, type TaskSample } from './aggregate.js';

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
});

describe('calibrate', () => {
  it('suggests nothing below three samples and p10–p90 / p90 from three', () => {
    const samples = [
      ...[10, 20, 30].map((turns, i) => sample({ task: `A-${i}`, turns, costUsd: i + 1 })),
      sample({ task: 'B-1', size: 'M' }),
      sample({ task: 'B-2', size: 'M' }),
    ];
    expect(calibrate(samples, DEFAULT_SIZES)).toEqual([
      { model: 'default', size: 'M', n: 2, current: DEFAULT_SIZES.M, suggestion: null },
      {
        model: 'default',
        size: 'S',
        n: 3,
        current: DEFAULT_SIZES.S,
        suggestion: { turns: [10, 30], usd: 3 },
      },
    ]);
  });
});
