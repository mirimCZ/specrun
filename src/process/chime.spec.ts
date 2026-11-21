import { describe, expect, it, vi } from 'vitest';
import { createFakeClock } from '../../test/fakes/fakeClock.js';
import {
  chime,
  chimeUntilKey,
  inSilentWindow,
  type ChimeChild,
  type ChimeOutcome,
  type KeyPress,
} from './chime.js';

function fakeChild(): ChimeChild {
  return { on: vi.fn(), unref: vi.fn() };
}

describe('chime', () => {
  it('plays a success or failure sound with afplay on darwin', () => {
    const spawn = vi.fn(() => fakeChild());
    const bell = vi.fn();
    chime('success', { platform: 'darwin', spawn, bell });
    chime('failure', { platform: 'darwin', spawn, bell });
    expect(spawn.mock.calls).toEqual([
      ['afplay', ['/System/Library/Sounds/Glass.aiff'], { stdio: 'ignore' }],
      ['afplay', ['/System/Library/Sounds/Basso.aiff'], { stdio: 'ignore' }],
    ]);
    expect(bell).not.toHaveBeenCalled();
  });

  it('rings the terminal bell on other platforms', () => {
    const spawn = vi.fn(() => fakeChild());
    const bell = vi.fn();
    for (const platform of ['linux', 'win32'] as const) chime('success', { platform, spawn, bell });
    expect(spawn).not.toHaveBeenCalled();
    expect(bell).toHaveBeenCalledTimes(2);
  });

  it('is a no-op when spawning throws', () => {
    const spawn = vi.fn((): ChimeChild => {
      throw new Error('ENOENT');
    });
    expect(() => chime('failure', { platform: 'darwin', spawn, bell: vi.fn() })).not.toThrow();
  });
});

describe('inSilentWindow', () => {
  const at = (hours: number, minutes = 0): Date => new Date(2026, 0, 1, hours, minutes);

  it('covers from inclusive to exclusive within a day', () => {
    const night = { from: '00:00', to: '08:00' };
    expect([at(0), at(7, 59), at(8), at(23, 59)].map((t) => inSilentWindow(t, night))).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it('spans midnight when from is after to', () => {
    const night = { from: '22:30', to: '07:00' };
    expect([at(22, 29), at(22, 30), at(3), at(7)].map((t) => inSilentWindow(t, night))).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });

  it('is never silent without a window or with equal bounds', () => {
    expect(inSilentWindow(at(3), null)).toBe(false);
    expect(inSilentWindow(at(3), { from: '03:00', to: '03:00' })).toBe(false);
  });
});

describe('chimeUntilKey', () => {
  it('repeats the chime every interval until a key, then releases the input', async () => {
    const clock = createFakeClock(new Date(2026, 0, 1, 12));
    const played: ChimeOutcome[] = [];
    let pressKey: (press: KeyPress) => void = () => undefined;
    let released = false;
    const end = await chimeUntilKey('failure', {
      clock,
      play: (outcome) => {
        played.push(outcome);
        if (played.length === 3) pressKey('interrupt');
      },
      waitForKey: (signal) => {
        signal.addEventListener('abort', () => (released = true));
        return new Promise((resolve) => (pressKey = resolve));
      },
      intervalMs: 2_000,
    });
    expect(end).toBe('interrupt');
    expect(played).toEqual(['failure', 'failure', 'failure']);
    expect(clock.sleeps.slice(0, 2)).toEqual([2_000, 2_000]);
    expect(released).toBe(true);
  });

  it('gives up after maxMs without a key', async () => {
    const clock = createFakeClock(new Date(2026, 0, 1, 12));
    const play = vi.fn();
    const end = await chimeUntilKey('success', {
      clock,
      play,
      waitForKey: () => new Promise(() => undefined),
      intervalMs: 2_000,
      maxMs: 10_000,
    });
    expect(end).toBe('timeout');
    expect(play).toHaveBeenCalledTimes(5);
  });
});
