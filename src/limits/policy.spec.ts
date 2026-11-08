import { describe, expect, it } from 'vitest';
import { decide, limitHitTarget, waitTarget } from './policy.js';
import type { UsageSnapshot, UsageWindow } from './usage.js';

const now = new Date('2026-11-09T10:00:00Z');
const limits = { sessionMinLeft: 15, weeklyMinLeft: 5 };
const reset = new Date('2026-11-09T12:00:00Z');

function win(leftPercent: number, resetsAt: Date | null = reset): UsageWindow {
  return { leftPercent, resetsAt };
}
function snap(session: UsageWindow | null, weekly: UsageWindow | null): UsageSnapshot {
  return { session, weekly, source: 'probe', at: now, rejected: false };
}

describe('decide', () => {
  it('goes without a snapshot or with plenty left', () => {
    expect(decide(null, limits, now)).toEqual({ action: 'go' });
    expect(decide(snap(win(80), win(80)), limits, now)).toEqual({ action: 'go' });
    expect(decide(snap(null, null), limits, now)).toEqual({ action: 'go' });
  });

  it('waits for the session reset + 60 s when the session is low', () => {
    expect(decide(snap(win(10), win(80)), limits, now)).toEqual({
      action: 'wait',
      until: new Date(reset.getTime() + 60_000),
      reason: 'session-low',
    });
  });

  it('stops when the week is low, and weekly wins over session', () => {
    const weeklyReset = new Date('2026-11-12T00:00:00Z');
    expect(decide(snap(win(1), win(2, weeklyReset)), limits, now)).toEqual({
      action: 'stop',
      reason: 'weekly-low',
      resetsAt: weeklyReset,
    });
  });

  it('treats the thresholds as exclusive', () => {
    expect(decide(snap(win(15), win(5)), limits, now)).toEqual({ action: 'go' });
    expect(decide(snap(win(14.9), win(5)), limits, now).action).toBe('wait');
    expect(decide(snap(win(15), win(4.9)), limits, now).action).toBe('stop');
  });
});

describe('waitTarget', () => {
  it('adds a minute to a future reset', () => {
    expect(waitTarget(reset, now)).toEqual(new Date(reset.getTime() + 60_000));
  });
  it('waits 30 min when the reset is unknown', () => {
    expect(waitTarget(null, now)).toEqual(new Date(now.getTime() + 30 * 60_000));
  });
  it('waits 5 min when the reset has passed', () => {
    const past = new Date(now.getTime() - 120_000);
    expect(waitTarget(past, now)).toEqual(new Date(now.getTime() + 5 * 60_000));
  });
});

describe('limitHitTarget', () => {
  it('uses the session reset of the snapshot', () => {
    expect(limitHitTarget(snap(win(0), win(50)), now)).toEqual(new Date(reset.getTime() + 60_000));
  });
  it('falls back to 30 min without a snapshot or session window', () => {
    const expected = new Date(now.getTime() + 30 * 60_000);
    expect(limitHitTarget(null, now)).toEqual(expected);
    expect(limitHitTarget(snap(null, win(50)), now)).toEqual(expected);
  });
});
