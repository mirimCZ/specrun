import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCommand } from '../process/run.js';
import { runVerify, summarizeFailure } from './verify.js';

let dir: string;
let logFile: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'specrun-'));
  logFile = join(dir, 'logs', 'verify.log');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const verify = (steps: { name: string; command: string }[]) =>
  runVerify({ steps, cwd: dir, logFile, run: runCommand });

describe('runVerify', () => {
  it('passes when all steps are green', async () => {
    const result = await verify([
      { name: 'a', command: 'echo hello' },
      { name: 'b', command: 'echo world' },
    ]);
    expect(result.ok).toBe(true);
    expect(result.steps.map((s) => s.name)).toEqual(['a', 'b']);
    expect(result.summary).toBe('');
    const log = readFileSync(logFile, 'utf8');
    expect(log).toContain('===== a =====\nhello\n');
    expect(log).toContain('===== b =====\nworld\n');
  });

  it('stops at the first red step and summarizes it', async () => {
    const result = await verify([
      { name: 'types', command: "echo 'src/x.ts(1,2): error TS2322: bad'; exit 1" },
      { name: 'tests', command: 'echo never' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({ name: 'types', ok: false });
    expect(result.summary).toContain('types');
    expect(result.summary).toContain('error TS2322');
    expect(result.summary).toContain(logFile);
    expect(readFileSync(logFile, 'utf8')).not.toContain('never');
  });
});

describe('summarizeFailure', () => {
  it('extracts vitest failure lines', () => {
    const output = [
      'noise line',
      ' FAIL  src/a.spec.ts > thing works',
      'AssertionError: expected 1 to be 2',
      '- Expected',
      '+ Received',
      ' ❯ src/a.spec.ts:10:5',
      'more noise',
    ].join('\n');
    const summary = summarizeFailure('test', output);
    expect(summary).toContain('FAIL  src/a.spec.ts');
    expect(summary).toContain('AssertionError');
    expect(summary).toContain('+ Received');
    expect(summary).toContain('❯ src/a.spec.ts:10:5');
    expect(summary).not.toContain('noise');
  });

  it('falls back to the last 40 lines', () => {
    const output = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n');
    const summary = summarizeFailure('lint', output);
    expect(summary).toContain('line 100');
    expect(summary).toContain('line 61');
    expect(summary).not.toContain('line 60\n');
  });

  it('caps the summary at 80 lines', () => {
    const output = Array.from({ length: 200 }, (_, i) => `error TS${1000 + i}: x`).join('\n');
    expect(summarizeFailure('tsc', output).split('\n').length).toBeLessThanOrEqual(79);
  });
});
