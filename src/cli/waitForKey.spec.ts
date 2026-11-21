import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { waitForKey, type KeyInput } from './waitForKey.js';

function fakeInput(): KeyInput & EventEmitter & { calls: string[] } {
  const emitter = new EventEmitter();
  const calls: string[] = [];
  return Object.assign(emitter, {
    calls,
    isRaw: false,
    setRawMode: (mode: boolean) => calls.push(`raw ${mode}`),
    resume: () => calls.push('resume'),
    pause: () => calls.push('pause'),
    ref: () => calls.push('ref'),
    unref: () => calls.push('unref'),
  });
}

describe('waitForKey', () => {
  it('resolves on any key in raw mode and restores the terminal', async () => {
    const input = fakeInput();
    const pressed = waitForKey(new AbortController().signal, input);
    input.emit('data', Buffer.from('x'));
    expect(await pressed).toBe('key');
    expect(input.calls).toEqual(['raw true', 'ref', 'resume', 'raw false', 'pause', 'unref']);
    expect(input.listenerCount('data')).toBe(0);
  });

  it('reports Ctrl+C as an interrupt', async () => {
    const input = fakeInput();
    const pressed = waitForKey(new AbortController().signal, input);
    input.emit('data', Buffer.from([0x03]));
    expect(await pressed).toBe('interrupt');
  });

  it('releases the input when aborted', async () => {
    const input = fakeInput();
    const controller = new AbortController();
    const pressed = waitForKey(controller.signal, input);
    controller.abort();
    expect(await pressed).toBe('key');
    expect(input.listenerCount('data')).toBe(0);
    expect(input.calls).toContain('raw false');
  });
});
