import type { Clock } from '../../src/limits/clock.js';

export type FakeClock = Clock & {
  /** Durations passed to `sleep`, in call order. */
  sleeps: number[];
  advance(ms: number): void;
};

/** `sleep` advances the time immediately instead of waiting. */
export function createFakeClock(start: Date): FakeClock {
  let current = start.getTime();
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => new Date(current),
    sleep(ms, signal) {
      if (signal?.aborted) {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        return Promise.reject(error);
      }
      sleeps.push(ms);
      current += ms;
      return Promise.resolve();
    },
    advance(ms) {
      current += ms;
    },
  };
}
