import type { Clock } from '../limits/clock.js';

export type ChimeOutcome = 'success' | 'failure';

export type ChimeChild = {
  on(event: 'error', listener: (error: Error) => void): unknown;
  unref?(): unknown;
};

export type ChimeSpawn = (
  command: string,
  args: string[],
  options: { stdio: 'ignore' },
) => ChimeChild;

export type ChimeDeps = {
  platform: NodeJS.Platform;
  spawn: ChimeSpawn;
  /** Writes the terminal bell (BEL); the fallback where no system sound is known. */
  bell: () => void;
};

const MAC_SOUNDS: Readonly<Record<ChimeOutcome, string>> = {
  success: '/System/Library/Sounds/Glass.aiff',
  failure: '/System/Library/Sounds/Basso.aiff',
};

export const CHIME_INTERVAL_MS = 2_000;
export const CHIME_MAX_MS = 30 * 60_000;

/**
 * Plays one chime: a system sound on a Mac (`afplay`), the terminal bell elsewhere. A
 * convenience, never a failure — spawn errors are swallowed.
 */
export function chime(outcome: ChimeOutcome, deps: ChimeDeps): void {
  if (deps.platform !== 'darwin') {
    deps.bell();
    return;
  }
  try {
    const child = deps.spawn('afplay', [MAC_SOUNDS[outcome]], { stdio: 'ignore' });
    // Spawn failures (ENOENT) arrive asynchronously as an 'error' event.
    child.on('error', () => {});
    // The sound must not keep specrun alive once its work is done.
    child.unref?.();
  } catch {
    // no sound, no harm
  }
}

/** Local `HH:MM` bounds; `from` after `to` spans midnight, equal bounds are an empty window. */
export type SilentWindow = { from: string; to: string };

function minutesOf(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export function inSilentWindow(now: Date, window: SilentWindow | null): boolean {
  if (window === null) return false;
  const at = now.getHours() * 60 + now.getMinutes();
  const from = minutesOf(window.from);
  const to = minutesOf(window.to);
  return from <= to ? at >= from && at < to : at >= from || at < to;
}

/** `interrupt`: the key was Ctrl+C. */
export type KeyPress = 'key' | 'interrupt';

export type ChimeEnd = KeyPress | 'timeout';

export type ChimeUntilKeyDeps = {
  play: (outcome: ChimeOutcome) => void;
  clock: Clock;
  /** Resolves on the first key; must release the input once `signal` aborts. */
  waitForKey: (signal: AbortSignal) => Promise<KeyPress>;
  intervalMs?: number;
  maxMs?: number;
};

/** Repeats the chime until a key is pressed or `maxMs` has passed. */
export async function chimeUntilKey(
  outcome: ChimeOutcome,
  deps: ChimeUntilKeyDeps,
): Promise<ChimeEnd> {
  const { clock, intervalMs = CHIME_INTERVAL_MS, maxMs = CHIME_MAX_MS } = deps;
  const stop = new AbortController();
  const ring = async (): Promise<'timeout'> => {
    const until = clock.now().getTime() + maxMs;
    while (!stop.signal.aborted && clock.now().getTime() < until) {
      deps.play(outcome);
      try {
        await clock.sleep(intervalMs, stop.signal);
      } catch {
        break;
      }
    }
    return 'timeout';
  };
  // A key stops the ringing right away, not only once the race is settled.
  const key = deps.waitForKey(stop.signal).then((press) => {
    stop.abort();
    return press;
  });
  try {
    return await Promise.race([key, ring()]);
  } finally {
    stop.abort();
  }
}
