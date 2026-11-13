import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  captureDeps,
  eventLine,
  makeTempRepo,
  writeDemoSpec,
} from '../../../test/fixtures/specRepo.js';
import { createProgram } from '../program.js';

let dir: string;
beforeEach(() => {
  dir = makeTempRepo();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function status(...args: string[]): Promise<string> {
  const deps = captureDeps(dir);
  await createProgram(deps).parseAsync(['node', 'specrun', 'status', ...args]);
  return deps.out.join('');
}

const blocked = (task: string): string =>
  eventLine({ t: 'task.blocked', task, reason: 'stuck', source: 'agent' });

describe('specrun status', () => {
  it('lists one line per spec', async () => {
    const specDir = writeDemoSpec(dir);
    writeFileSync(join(specDir, 'events.jsonl'), blocked('D-1'));
    const output = await status();
    expect(output).toMatch(/demo\s+0\/2\s+1 blocked/);
    expect(JSON.parse(await status('--json'))).toEqual([
      { name: 'demo', done: 0, total: 2, blocked: 1, workspace: 'checkout', runningPid: null },
    ]);
  });

  it('shows the task table with worktree info, preferring the worktree events', async () => {
    const specDir = writeDemoSpec(dir);
    writeFileSync(join(specDir, 'events.jsonl'), '');
    const worktree = join(dir, '.specrun', 'worktrees', 'demo');
    const worktreeSpec = writeDemoSpec(worktree, worktree);
    writeFileSync(join(worktreeSpec, 'events.jsonl'), blocked('D-2'));
    const output = await status('demo');
    expect(output).toMatch(/D-2\s+Second\s+M\s+strong\s+blocked/);
    expect(output).toMatch(/D-1\s+First\s+S\s+default\s+todo/);
    expect(output).toContain(`worktree: ${worktree}`);
    expect(output).toContain('not running');
  });

  it('shows running (pid N) while the lock holder is alive', async () => {
    writeDemoSpec(dir);
    mkdirSync(join(dir, '.specrun', 'locks'), { recursive: true });
    writeFileSync(join(dir, '.specrun', 'locks', 'demo.lock'), `${process.pid}\n`);
    expect(await status('demo')).toContain(`running (pid ${process.pid})`);
    const parsed = JSON.parse(await status('demo', '--json')) as { runningPid: number };
    expect(parsed.runningPid).toBe(process.pid);
  });

  it('fails for an unknown spec', async () => {
    writeDemoSpec(dir);
    await expect(status('nope')).rejects.toThrow(/not found/);
  });
});
