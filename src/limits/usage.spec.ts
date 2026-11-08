import { describe, expect, it } from 'vitest';
import { fromRateLimitEvent, fromUsageProbe } from './usage.js';

const at = new Date('2026-11-09T10:00:00Z');
const reset = new Date('2026-11-09T12:00:00Z');
const weeklyReset = new Date('2026-11-14T12:00:00Z');

describe('usage normalization', () => {
  it('maps both sources to the same snapshot shape', () => {
    const event = fromRateLimitEvent(
      {
        status: 'allowed',
        unifiedWindows: {
          five_hour: { utilization: 0.25, resetsAt: reset.getTime() / 1000 },
          seven_day: { utilization: 0.5, resetsAt: weeklyReset.getTime() / 1000 },
        },
      },
      at,
    );
    const probe = fromUsageProbe(
      {
        rate_limits: {
          five_hour: { utilization: 25, resets_at: reset.toISOString() },
          seven_day: { utilization: 50, resets_at: weeklyReset.toISOString() },
        },
      },
      at,
    );
    expect(event).toEqual({ ...probe, source: 'event' });
    expect(event?.session).toEqual({ leftPercent: 75, resetsAt: reset });
    expect(event?.weekly).toEqual({ leftPercent: 50, resetsAt: weeklyReset });
    expect(probe?.source).toBe('probe');
  });

  it('treats missing and null windows as null', () => {
    const event = fromRateLimitEvent(
      { unifiedWindows: { five_hour: null, extra: 1 }, other: true },
      at,
    );
    expect(event).toMatchObject({ session: null, weekly: null, rejected: false });
    const probe = fromUsageProbe({ rate_limits: { five_hour: null } }, at);
    expect(probe).toMatchObject({ session: null, weekly: null });
    expect(fromRateLimitEvent({}, at)).toMatchObject({ session: null, weekly: null });
  });

  it('keeps a window without a reset time', () => {
    const probe = fromUsageProbe({ rate_limits: { seven_day: { utilization: 10 } } }, at);
    expect(probe?.weekly).toEqual({ leftPercent: 90, resetsAt: null });
  });

  it('flags a rejected status', () => {
    expect(fromRateLimitEvent({ status: 'rejected' }, at)?.rejected).toBe(true);
    expect(fromRateLimitEvent({ status: 'allowed_warning' }, at)?.rejected).toBe(false);
  });

  it('returns null for garbage', () => {
    for (const garbage of [null, undefined, 'x', 42, [], { unifiedWindows: 'no' }]) {
      expect(fromRateLimitEvent(garbage, at)).toBeNull();
    }
    for (const garbage of [null, 'x', {}, { rate_limits: 5 }, { rate_limits: null }]) {
      expect(fromUsageProbe(garbage, at)).toBeNull();
    }
  });
});
