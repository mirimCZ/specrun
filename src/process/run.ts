import { spawn } from 'node:child_process';

export interface RunOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** Written to stdin, then stdin is closed. */
  input?: string;
  timeoutMs?: number;
}

export interface RunResult {
  /** Exit code; a killed or unspawnable process reports -1. */
  code: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export type ProcessRunner = (
  cmd: string,
  args: readonly string[],
  opts: RunOptions,
) => Promise<RunResult>;

export const runCommand: ProcessRunner = (cmd, args, opts) =>
  new Promise((resolve) => {
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer: NodeJS.Timeout | null = null;
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr, durationMs: Date.now() - started });
    };

    const child = spawn(cmd, [...args], {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (opts.timeoutMs) timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs);

    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', (error) => {
      stderr += error.message;
      finish(-1);
    });
    child.on('close', (code) => finish(code ?? -1));
    // EPIPE when the process exits before reading stdin is not an error for us.
    child.stdin.on('error', () => undefined);
    child.stdin.end(opts.input ?? '');
  });

export interface InteractiveResult {
  code: number;
  /** Set when the process could not be started (e.g. not on PATH). */
  error: string | null;
}

export type InteractiveRunner = (
  cmd: string,
  args: readonly string[],
  opts: Pick<RunOptions, 'cwd' | 'env'>,
) => Promise<InteractiveResult>;

/** Hands this terminal to `cmd` (inherited stdio) until it exits. */
export const runInteractive: InteractiveRunner = (cmd, args, opts) =>
  new Promise((resolve) => {
    // Ctrl+C goes to the whole foreground group; the child handles it, we must not die of it.
    const ignore = (): void => undefined;
    process.on('SIGINT', ignore);
    let settled = false;
    const finish = (result: InteractiveResult): void => {
      if (settled) return;
      settled = true;
      process.off('SIGINT', ignore);
      resolve(result);
    };
    const child = spawn(cmd, [...args], {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: 'inherit',
    });
    child.on('error', (error) => finish({ code: -1, error: error.message }));
    child.on('close', (code) => finish({ code: code ?? 1, error: null }));
  });

/** Runs `command` through `sh -c`. */
export function runShell(
  command: string,
  opts: RunOptions,
  run: ProcessRunner = runCommand,
): Promise<RunResult> {
  return run('sh', ['-c', command], opts);
}
