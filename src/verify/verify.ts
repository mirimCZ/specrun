import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Config } from '../config/configSchema.js';
import { runShell, type ProcessRunner } from '../process/run.js';

export type VerifyStep = Config['verify'][number];

export interface VerifyStepResult {
  name: string;
  ok: boolean;
  durationMs: number;
}

export interface VerifyResult {
  ok: boolean;
  durationMs: number;
  steps: VerifyStepResult[];
  /** Empty when ok. */
  summary: string;
}

export interface RunVerifyInput {
  steps: readonly VerifyStep[];
  cwd: string;
  logFile: string;
  run: ProcessRunner;
}

const MAX_SUMMARY_LINES = 80;
const TAIL_LINES = 40;
// Same line classes as tools/spec-verify.sh report_failure.
const ERROR_LINE =
  /error TS\d+|^\s*(FAIL|×) |AssertionError|^\s*(Error|TypeError|ReferenceError|SyntaxError):|^\s*[-+] (Expected|Received)|^\s*(Expected|Received)\b|❯ .*:\d+:\d+/;

// eslint-disable-next-line no-control-regex -- stripping terminal colour codes
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

/** Header + the lines worth showing (or the output tail), at most 79 lines; the caller adds the log path. */
export function summarizeFailure(stepName: string, output: string): string {
  const all = output.replace(ANSI, '').split('\n');
  const matched = [
    ...new Set(all.filter((line) => ERROR_LINE.test(line) && !line.includes('node_modules/'))),
  ];
  const body =
    matched.length > 0 ? matched : all.filter((line) => line.trim() !== '').slice(-TAIL_LINES);
  return [`Step "${stepName}" failed:`, ...body.slice(0, MAX_SUMMARY_LINES - 2)].join('\n');
}

export async function runVerify(input: RunVerifyInput): Promise<VerifyResult> {
  const { steps, cwd, logFile, run } = input;
  await mkdir(dirname(logFile), { recursive: true });
  await writeFile(logFile, '');

  const results: VerifyStepResult[] = [];
  let summary = '';
  let total = 0;
  for (const step of steps) {
    const result = await runShell(step.command, { cwd }, run);
    const output = result.stdout + result.stderr;
    await appendFile(
      logFile,
      `===== ${step.name} =====\n${output}${output.endsWith('\n') ? '' : '\n'}`,
    );
    total += result.durationMs;
    const ok = result.code === 0;
    results.push({ name: step.name, ok, durationMs: result.durationMs });
    if (!ok) {
      summary = `${summarizeFailure(step.name, output)}\nFull log: ${logFile}`;
      break;
    }
  }
  return { ok: results.every((r) => r.ok), durationMs: total, steps: results, summary };
}
