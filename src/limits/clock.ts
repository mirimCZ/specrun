export type Clock = {
  now(): Date;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
};

function abortError(): Error {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

export const systemClock: Clock = {
  now: () => new Date(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(abortError());
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    }),
};

export type WaitUntilOptions = {
  clock: Clock;
  signal?: AbortSignal;
  /** Called before every sleep with the remaining milliseconds. */
  onTick?: (remainingMs: number) => void;
  tickMs?: number;
};

/**
 * Sleeps in short ticks and recomputes the remaining time from `clock.now()` each time, so a
 * Mac that slept in between does not oversleep. Rejects with an `AbortError` on `signal`.
 */
export async function waitUntil(target: Date, opts: WaitUntilOptions): Promise<void> {
  const { clock, signal, onTick, tickMs = 1000 } = opts;
  for (;;) {
    if (signal?.aborted) throw abortError();
    const remaining = target.getTime() - clock.now().getTime();
    if (remaining <= 0) return;
    onTick?.(remaining);
    await clock.sleep(Math.min(tickMs, remaining), signal);
  }
}
