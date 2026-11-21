import type { KeyPress } from '../process/chime.js';

/** The part of `process.stdin` a single keypress needs. */
export interface KeyInput {
  isRaw?: boolean;
  setRawMode?(mode: boolean): unknown;
  on(event: 'data', listener: (data: Buffer) => void): unknown;
  off(event: 'data', listener: (data: Buffer) => void): unknown;
  resume(): unknown;
  pause(): unknown;
  ref?(): unknown;
  unref?(): unknown;
}

const CTRL_C = 0x03;

/**
 * Resolves on the first key from a terminal in raw mode — no Enter needed. On `signal` it gives
 * the input back unread, so a question asked next sees a clean stdin.
 */
export function waitForKey(
  signal: AbortSignal,
  input: KeyInput = process.stdin,
): Promise<KeyPress> {
  return new Promise((resolve) => {
    const wasRaw = input.isRaw === true;
    const finish = (press: KeyPress): void => {
      input.off('data', onData);
      signal.removeEventListener('abort', onAbort);
      input.setRawMode?.(wasRaw);
      input.pause();
      // Ink leaves stdin unref'd; ref'd it would keep node alive after the last question.
      input.unref?.();
      resolve(press);
    };
    // Raw mode turns Ctrl+C into a byte instead of SIGINT.
    const onData = (data: Buffer): void => finish(data.includes(CTRL_C) ? 'interrupt' : 'key');
    const onAbort = (): void => finish('key');
    if (signal.aborted) {
      resolve('key');
      return;
    }
    input.setRawMode?.(true);
    input.ref?.();
    input.on('data', onData);
    signal.addEventListener('abort', onAbort, { once: true });
    input.resume();
  });
}
