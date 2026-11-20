import { describe, expect, it } from 'vitest';
import { createFakeClock } from '../../test/fakes/fakeClock.js';
import { createFakeQuery } from '../../test/fakes/fakeQuery.js';
import { systemClock } from '../limits/clock.js';
import { probeUsage } from './probeUsage.js';

const USAGE = {
  rate_limits: {
    five_hour: { utilization: 25, resets_at: '2026-11-09T05:00:00Z' },
    seven_day: { utilization: 60, resets_at: '2026-11-12T00:00:00Z' },
  },
};

describe('probeUsage', () => {
  it('asks for usage after the control handshake and closes the query', async () => {
    const fake = createFakeQuery([[{ control: 'hang' }]], { usage: USAGE });
    // A real timer that is cancelled once the probe answered.
    const snapshot = await probeUsage({ query: fake.query, cwd: '/work', clock: systemClock });

    expect(snapshot).toMatchObject({
      source: 'probe',
      session: { leftPercent: 75, resetsAt: new Date('2026-11-09T05:00:00Z') },
      weekly: { leftPercent: 40 },
    });
    expect(fake.usageCalls).toBe(1);
    expect(fake.closed).toBe(1);
    const call = fake.calls[0];
    expect(typeof call?.prompt).not.toBe('string');
    expect(call?.options).toMatchObject({ cwd: '/work', tools: [] });
    expect(call?.options && 'env' in call.options).toBe(false);
  });

  it('passes the given env to query()', async () => {
    const fake = createFakeQuery([[{ control: 'hang' }]], { usage: USAGE });
    const env = { CLAUDE_CODE_OAUTH_TOKEN: 'lorem-token' };
    await probeUsage({ query: fake.query, cwd: '/work', clock: systemClock, env });
    expect(fake.calls[0]?.options.env).toEqual(env);
  });

  it('returns null when the SDK does not answer in time', async () => {
    const fake = createFakeQuery([[{ control: 'hang' }]], { usage: USAGE, init: 'hang' });
    const clock = createFakeClock(new Date('2026-11-09T00:00:00Z'));
    const snapshot = await probeUsage({ query: fake.query, cwd: '/work', clock });

    expect(snapshot).toBeNull();
    expect(clock.sleeps).toEqual([15_000]);
    expect(fake.closed).toBe(1);
  });

  it('returns null when the probe call fails', async () => {
    const fake = createFakeQuery([[{ control: 'hang' }]], {
      usage: new Error('unsupported'),
    });
    const snapshot = await probeUsage({ query: fake.query, cwd: '/work', clock: systemClock });
    expect(snapshot).toBeNull();
  });

  it('returns null without rate limits in the response', async () => {
    const fake = createFakeQuery([[{ control: 'hang' }]], { usage: {} });
    const snapshot = await probeUsage({ query: fake.query, cwd: '/work', clock: systemClock });
    expect(snapshot).toBeNull();
  });
});
