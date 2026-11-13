import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SpecrunError } from '../errors.js';

export interface Lock {
  release(): void;
}

export function lockFile(repoRoot: string, spec: string): string {
  return join(repoRoot, '.specrun', 'locks', `${spec}.lock`);
}

/** `kill(pid, 0)` probes without signalling; EPERM means the process exists under another user. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}

export function readLockPid(file: string): number | null {
  try {
    const pid = Number.parseInt(readFileSync(file, 'utf8').trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isExistsError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

/** SRD-4: one run per spec. A lock whose pid is dead (or unreadable) is taken over. */
export function acquireLock(file: string, pid: number, isAlive: (pid: number) => boolean): Lock {
  mkdirSync(dirname(file), { recursive: true });
  // Two attempts: the second follows the removal of a stale lock.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(file, `${pid}\n`, { flag: 'wx' });
      return {
        release() {
          // Only our own lock: a run that took over a lock it considered stale keeps its file.
          if (readLockPid(file) === pid) unlinkSync(file);
        },
      };
    } catch (error) {
      if (!isExistsError(error)) throw error;
    }
    const holder = readLockPid(file);
    // Reentrant: `run --all` holds every spec's lock while runSpec takes each again.
    if (holder === pid) return { release: () => undefined };
    if (holder !== null && isAlive(holder)) {
      throw new SpecrunError('locked', `Another specrun run holds ${file} (pid ${holder})`);
    }
    unlinkSync(file);
  }
  throw new SpecrunError('locked', `Could not take over the stale lock ${file}`);
}
