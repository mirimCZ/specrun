import { SpecrunError } from '../errors.js';
import type { ProcessRunner } from '../process/run.js';
import type { Account } from './accounts.js';

export const TOKEN_COMMAND_TIMEOUT_MS = 10_000;

export type TokenDeps = {
  env: NodeJS.ProcessEnv;
  run: ProcessRunner;
  platform: NodeJS.Platform;
  cwd: string;
};

function tokenError(account: Account, reason: string, details: string[] = []): SpecrunError {
  return new SpecrunError('account-token', `account ${account.name}: ${reason}`, details);
}

/** Resolves the account's token; null means the system login. Never echoes stdout. */
export async function resolveToken(account: Account, deps: TokenDeps): Promise<string | null> {
  const source = account.token;
  if (source === null) return null;

  if ('env' in source) {
    const value = deps.env[source.env]?.trim();
    if (!value) throw tokenError(account, `environment variable ${source.env} is missing or empty`);
    return value;
  }

  const [cmd, args] =
    deps.platform === 'win32'
      ? ['cmd.exe', ['/d', '/s', '/c', source.command]]
      : ['/bin/sh', ['-c', source.command]];
  const result = await deps.run(cmd as string, args as string[], {
    cwd: deps.cwd,
    timeoutMs: TOKEN_COMMAND_TIMEOUT_MS,
  });
  if (result.code === -1) {
    throw tokenError(
      account,
      `token command timed out or could not start`,
      stderrDetail(result.stderr),
    );
  }
  if (result.code !== 0) {
    throw tokenError(
      account,
      `token command exited with code ${result.code}`,
      stderrDetail(result.stderr),
    );
  }
  const token = result.stdout.trim();
  if (!token) throw tokenError(account, 'token command printed nothing');
  return token;
}

function stderrDetail(stderr: string): string[] {
  const line = stderr.split('\n').find((l) => l.trim() !== '');
  return line ? [line.trim()] : [];
}
