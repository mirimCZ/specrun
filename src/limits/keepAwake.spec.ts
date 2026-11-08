import { describe, expect, it, vi, type Mock } from 'vitest';
import { keepAwake, type KeepAwakeChild } from './keepAwake.js';

function fakeChild(): KeepAwakeChild & { kill: Mock<() => void> } {
  return { kill: vi.fn<() => void>(), on: vi.fn(), unref: vi.fn() };
}

describe('keepAwake', () => {
  it('spawns caffeinate for the pid on darwin and kills it on stop', () => {
    const child = fakeChild();
    const spawn = vi.fn(() => child);
    const handle = keepAwake({ pid: 4242, platform: 'darwin', spawn });
    expect(spawn).toHaveBeenCalledWith('caffeinate', ['-i', '-w', '4242'], { stdio: 'ignore' });
    handle.stop();
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('does nothing on other platforms', () => {
    const spawn = vi.fn(() => fakeChild());
    keepAwake({ pid: 1, platform: 'linux', spawn }).stop();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('is a no-op when spawning throws', () => {
    const spawn = vi.fn(() => {
      throw new Error('ENOENT');
    });
    expect(() => keepAwake({ pid: 1, platform: 'darwin', spawn }).stop()).not.toThrow();
  });
});
