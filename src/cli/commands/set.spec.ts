import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureDeps, makeTempRepo, writeDemoSpec } from '../../../test/fixtures/specRepo.js';
import { createProgram } from '../program.js';

let dir: string;
beforeEach(() => {
  dir = makeTempRepo();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function set(...args: string[]): Promise<void> {
  await createProgram(captureDeps(dir)).parseAsync(['node', 'specrun', 'set', ...args]);
}

describe('specrun set', () => {
  it('appends manual.status to the checkout events without a worktree', async () => {
    const specDir = writeDemoSpec(dir);
    await set('demo', 'D-1', 'done', '--reason', 'finished by hand');
    const [line] = readFileSync(join(specDir, 'events.jsonl'), 'utf8').trim().split('\n');
    expect(JSON.parse(line ?? '')).toMatchObject({
      t: 'manual.status',
      task: 'D-1',
      status: 'done',
      reason: 'finished by hand',
    });
  });

  it('prefers the worktree events file', async () => {
    const specDir = writeDemoSpec(dir);
    const worktree = join(dir, '.specrun', 'worktrees', 'demo');
    const worktreeSpec = writeDemoSpec(worktree, worktree);
    await set('demo', 'D-2', 'blocked', '--reason', 'x');
    expect(readFileSync(join(worktreeSpec, 'events.jsonl'), 'utf8')).toContain('manual.status');
    expect(() => readFileSync(join(specDir, 'events.jsonl'))).toThrow();
  });

  it('refuses while a run holds the lock', async () => {
    writeDemoSpec(dir);
    mkdirSync(join(dir, '.specrun', 'locks'), { recursive: true });
    writeFileSync(join(dir, '.specrun', 'locks', 'demo.lock'), `${process.pid}\n`);
    await expect(set('demo', 'D-1', 'done', '--reason', 'x')).rejects.toThrow(/holds the lock/);
  });

  it('rejects unknown tasks and statuses', async () => {
    writeDemoSpec(dir);
    await expect(set('demo', 'X-9', 'done', '--reason', 'x')).rejects.toThrow(/not in spec/);
    await expect(set('demo', 'D-1', 'interrupted', '--reason', 'x')).rejects.toThrow(/Invalid/);
  });
});
