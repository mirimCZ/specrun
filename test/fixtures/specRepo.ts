import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import type { CliDeps } from '../../src/cli/cliDeps.js';

export function makeTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'specrun-'));
  // findRepoRoot only needs a `.git` entry.
  mkdirSync(join(dir, '.git'));
  return dir;
}

/** A repo with a config and spec `demo` with tasks D-1 (phase 1) and D-2 (phase 1, needs D-1). */
export function writeDemoSpec(root: string, specsRoot: string = root): string {
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, 'specrun.config.json'),
    JSON.stringify({ verify: [{ name: 'ok', command: 'true' }] }),
  );
  const dir = join(specsRoot, 'docs', 'demo');
  mkdirSync(join(dir, 'tasks'), { recursive: true });
  writeFileSync(
    join(dir, 'tasks.yaml'),
    stringify({
      title: 'Demo',
      tasks: [
        { id: 'D-1', title: 'First', phase: 1, needs: [], model: 'default', size: 'S' },
        { id: 'D-2', title: 'Second', phase: 1, needs: ['D-1'], model: 'strong', size: 'M' },
      ],
    }),
  );
  writeFileSync(join(dir, 'tasks', 'D-1.md'), '# D-1\n');
  writeFileSync(join(dir, 'tasks', 'D-2.md'), '# D-2\n');
  return dir;
}

export interface CapturedDeps extends CliDeps {
  out: string[];
  err: string[];
}

export function captureDeps(cwd: string): CapturedDeps {
  const out: string[] = [];
  const err: string[] = [];
  return {
    cwd,
    stdout: (text) => void out.push(text),
    stderr: (text) => void err.push(text),
    env: {},
    now: () => new Date('2026-01-01T10:00:00.000Z'),
    interactive: false,
    prompter: () => {
      throw new Error('captureDeps is not interactive');
    },
    out,
    err,
  };
}

export function eventLine(fields: Record<string, unknown>): string {
  return `${JSON.stringify({ v: 1, at: '2026-01-01T09:00:00.000Z', runId: 'r1', ...fields })}\n`;
}
