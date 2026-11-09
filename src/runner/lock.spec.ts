import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acquireLock, isProcessAlive } from './lock.js';

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'specrun-'));
  file = join(dir, 'locks', 'demo.lock');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('acquireLock', () => {
  it('writes the pid and removes the file on release', () => {
    const lock = acquireLock(file, 123, () => true);
    expect(readFileSync(file, 'utf8').trim()).toBe('123');
    lock.release();
    expect(existsSync(file)).toBe(false);
  });

  it('refuses a lock held by a live pid', () => {
    acquireLock(file, 42, () => true);
    expect(() => acquireLock(file, 43, (pid) => pid === 42)).toThrow(
      expect.objectContaining({ code: 'locked', message: expect.stringContaining('pid 42') }),
    );
  });

  it('takes over a stale lock', () => {
    acquireLock(file, 42, () => true);
    const lock = acquireLock(file, 43, () => false);
    expect(readFileSync(file, 'utf8').trim()).toBe('43');
    lock.release();
    expect(existsSync(file)).toBe(false);
  });

  it('takes over an unreadable lock and keeps a lock it no longer owns on release', () => {
    acquireLock(file, 42, () => true);
    writeFileSync(file, 'garbage');
    const lock = acquireLock(file, 43, () => true);
    writeFileSync(file, '44\n');
    lock.release();
    expect(readFileSync(file, 'utf8').trim()).toBe('44');
  });
});

describe('isProcessAlive', () => {
  it('sees the current process', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });
});
