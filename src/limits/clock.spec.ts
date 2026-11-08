import { describe, expect, it } from 'vitest';
import { createFakeClock } from '../../test/fakes/fakeClock.js';
import { waitUntil } from './clock.js';

const start = new Date('2026-11-09T10:00:00Z');

describe('waitUntil', () => {
  it('ticks until the target and resolves', async () => {
    const clock = createFakeClock(start);
    const ticks: number[] = [];
    await waitUntil(new Date(start.getTime() + 2500), {
      clock,
      onTick: (ms) => ticks.push(ms),
    });
    expect(ticks).toEqual([2500, 1500, 500]);
    expect(clock.sleeps).toEqual([1000, 1000, 500]);
    expect(clock.now().getTime()).toBe(start.getTime() + 2500);
  });

  it('resolves immediately when the target has passed', async () => {
    const clock = createFakeClock(start);
    await waitUntil(new Date(start.getTime() - 1), { clock });
    expect(clock.sleeps).toEqual([]);
  });

  it('recomputes from the clock, so a jump (Mac sleep) ends the wait early', async () => {
    const clock = createFakeClock(start);
    const target = new Date(start.getTime() + 10_000);
    await waitUntil(target, { clock, onTick: () => clock.advance(60_000) });
    // The tick still sleeps once (clamped), then the next check sees the passed target.
    expect(clock.sleeps).toEqual([1000]);
  });

  it('rejects with AbortError on abort', async () => {
    const clock = createFakeClock(start);
    const controller = new AbortController();
    const promise = waitUntil(new Date(start.getTime() + 10_000), {
      clock,
      signal: controller.signal,
      onTick: () => controller.abort(),
    });
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });
});
