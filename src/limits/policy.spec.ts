import { describe, expect, it } from 'vitest';
import {
  chooseAccount,
  decide,
  limitHitTarget,
  switchReason,
  waitTarget,
  type AccountUsage,
} from './policy.js';
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

function account(
  name: string,
  snapshot: UsageSnapshot | null = null,
  blockedUntil: Date | null = null,
): AccountUsage {
  return { name, limits, snapshot, blockedUntil };
}

const plenty = snap(win(80), win(80));
const sessionLow = snap(win(10), win(80));
const later = new Date('2026-11-09T14:00:00Z');
const sessionLowLater = snap(win(10, later), win(80));
const weeklyReset = new Date('2026-11-12T00:00:00Z');
const weeklyResetEarlier = new Date('2026-11-11T00:00:00Z');
const weeklyLow = snap(win(80), win(2, weeklyReset));
const afterReset = new Date(reset.getTime() + 60_000);
const noBurn = { burn: false, current: null };
const burn = { burn: true, current: null };

describe('chooseAccount', () => {
  it('throws on an empty account list', () => {
    expect(() => chooseAccount([], noBurn, now)).toThrow(Error);
  });

  it('gives the decision of decide for a single account', () => {
    expect(chooseAccount([account('lorem', plenty)], noBurn, now)).toEqual({
      action: 'go',
      account: 'lorem',
    });
    expect(chooseAccount([account('lorem', sessionLow)], noBurn, now)).toEqual({
      action: 'wait',
      account: 'lorem',
      until: afterReset,
      reason: 'session-low',
    });
    expect(chooseAccount([account('lorem', weeklyLow)], burn, now)).toEqual({
      action: 'stop',
      reason: 'weekly-low',
      resetsAt: weeklyReset,
    });
  });

  it('lets the priority account go when it can', () => {
    const accounts = [account('lorem', plenty), account('ipsum', plenty)];
    expect(chooseAccount(accounts, noBurn, now)).toEqual({ action: 'go', account: 'lorem' });
    expect(chooseAccount(accounts, burn, now)).toEqual({ action: 'go', account: 'lorem' });
  });

  it('falls back past a weekly-low priority account without burn', () => {
    const accounts = [account('lorem', weeklyLow), account('ipsum', plenty)];
    expect(chooseAccount(accounts, noBurn, now)).toEqual({ action: 'go', account: 'ipsum' });
  });

  it('waits on a session-low priority account without burn although the fallback could go', () => {
    const accounts = [account('lorem', sessionLow), account('ipsum', plenty)];
    expect(chooseAccount(accounts, noBurn, now)).toEqual({
      action: 'wait',
      account: 'lorem',
      until: afterReset,
      reason: 'session-low',
    });
  });

  it('moves past a session-low priority account with burn', () => {
    const accounts = [account('lorem', sessionLow), account('ipsum', plenty)];
    expect(chooseAccount(accounts, burn, now)).toEqual({ action: 'go', account: 'ipsum' });
  });

  it('prefers current over a higher-priority account and leaves it only when forced', () => {
    const accounts = [account('lorem', plenty), account('ipsum', plenty)];
    expect(chooseAccount(accounts, { burn: false, current: 'ipsum' }, now)).toEqual({
      action: 'go',
      account: 'ipsum',
    });

    const forced = [account('lorem', plenty), account('ipsum', weeklyLow)];
    expect(chooseAccount(forced, { burn: false, current: 'ipsum' }, now)).toEqual({
      action: 'go',
      account: 'lorem',
    });

    const sessionLowCurrent = [account('lorem', plenty), account('ipsum', sessionLow)];
    expect(chooseAccount(sessionLowCurrent, { burn: false, current: 'ipsum' }, now)).toEqual({
      action: 'wait',
      account: 'ipsum',
      until: afterReset,
      reason: 'session-low',
    });
    expect(chooseAccount(sessionLowCurrent, { burn: true, current: 'ipsum' }, now)).toEqual({
      action: 'go',
      account: 'lorem',
    });
  });

  it('ignores a current account that is not in the list', () => {
    const accounts = [account('lorem', plenty), account('ipsum', plenty)];
    expect(chooseAccount(accounts, { burn: false, current: 'dolor' }, now)).toEqual({
      action: 'go',
      account: 'lorem',
    });
  });

  it('waits on a blocked account without burn and moves on with burn', () => {
    const blockedUntil = new Date('2026-11-09T11:00:00Z');
    const accounts = [account('lorem', plenty, blockedUntil), account('ipsum', plenty)];
    expect(chooseAccount(accounts, noBurn, now)).toEqual({
      action: 'wait',
      account: 'lorem',
      until: blockedUntil,
      reason: 'limit-hit',
    });
    expect(chooseAccount(accounts, burn, now)).toEqual({ action: 'go', account: 'ipsum' });
  });

  it('ignores a blockedUntil in the past', () => {
    const past = new Date(now.getTime() - 60_000);
    const accounts = [account('lorem', plenty, past), account('ipsum', plenty)];
    expect(chooseAccount(accounts, noBurn, now)).toEqual({ action: 'go', account: 'lorem' });
  });

  it('waits on the earliest until with burn when every account is session-low', () => {
    const accounts = [account('lorem', sessionLowLater), account('ipsum', sessionLow)];
    expect(chooseAccount(accounts, burn, now)).toEqual({
      action: 'wait',
      account: 'ipsum',
      until: afterReset,
      reason: 'session-low',
    });
  });

  it('breaks a tie between waits towards the earlier candidate', () => {
    const accounts = [account('lorem', sessionLow), account('ipsum', sessionLow)];
    expect(chooseAccount(accounts, burn, now)).toMatchObject({ action: 'wait', account: 'lorem' });
  });

  it('stops with the earliest weekly reset when every account is weekly-low', () => {
    const accounts = [
      account('lorem', weeklyLow),
      account('ipsum', snap(win(80), win(1, weeklyResetEarlier))),
      account('dolor', snap(win(80), win(1, null))),
    ];
    const stop = { action: 'stop', reason: 'weekly-low', resetsAt: weeklyResetEarlier };
    expect(chooseAccount(accounts, noBurn, now)).toEqual(stop);
    expect(chooseAccount(accounts, burn, now)).toEqual(stop);
  });

  it('skips a weekly-low account even when it is also blocked', () => {
    const blockedUntil = new Date('2026-11-09T11:00:00Z');
    const accounts = [account('lorem', weeklyLow, blockedUntil), account('ipsum', plenty)];
    expect(chooseAccount(accounts, noBurn, now)).toEqual({ action: 'go', account: 'ipsum' });
  });
});

describe('switchReason', () => {
  it('is limit-hit when the account is blocked', () => {
    expect(switchReason(account('lorem', plenty, later), now)).toBe('limit-hit');
  });
  it('is weekly-low when the week is low', () => {
    expect(switchReason(account('lorem', weeklyLow), now)).toBe('weekly-low');
  });
  it('is session-low when the session is low', () => {
    expect(switchReason(account('lorem', sessionLow), now)).toBe('session-low');
  });
  it('is priority when the account could still go', () => {
    expect(switchReason(account('lorem', plenty), now)).toBe('priority');
  });
});
