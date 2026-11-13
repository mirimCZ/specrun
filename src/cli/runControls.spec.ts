import { describe, expect, it } from 'vitest';
import { createRunControls } from './runControls.js';

function setup(): { controls: ReturnType<typeof createRunControls>; calls: string[] } {
  const calls: string[] = [];
  const controls = createRunControls({
    abort: () => void calls.push('abort'),
    log: (message) => void calls.push(message.split(' — ')[0] ?? message),
  });
  return { controls, calls };
}

describe('createRunControls', () => {
  it('asks to stop on the first Ctrl+C and aborts on the second', () => {
    const { controls, calls } = setup();
    const notified: boolean[] = [];
    controls.stop.onRequest(() => void notified.push(controls.stop.requested));

    controls.interrupt();
    expect(controls.stop.requested).toBe(true);
    expect(notified).toEqual([true]);
    controls.interrupt();
    expect(calls).toEqual(['⏹ stop requested', 'interrupting now', 'abort']);
  });

  it('cancels a pending stop, so the next Ctrl+C asks again instead of aborting', () => {
    const { controls, calls } = setup();
    controls.requestStop();
    controls.requestStop();
    controls.cancelStop();
    expect(controls.stop.requested).toBe(false);
    controls.cancelStop();
    controls.interrupt();
    expect(calls).toEqual(['⏹ stop requested', 'stop cancelled', '⏹ stop requested']);
  });
});
