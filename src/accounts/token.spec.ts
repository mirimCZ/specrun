import { describe, expect, it } from 'vitest';
import type { ProcessRunner, RunResult } from '../process/run.js';
import { SpecrunError } from '../errors.js';
import type { Account } from './accounts.js';
import { resolveToken, TOKEN_COMMAND_TIMEOUT_MS, type TokenDeps } from './token.js';

const limits = { sessionMinLeft: 15, weeklyMinLeft: 5 };
const account = (token: Account['token']): Account => ({ name: 'lorem', token, limits });

type Call = { cmd: string; args: readonly string[]; timeoutMs: number | undefined };

function setup(
  result: Partial<RunResult> = {},
  env: NodeJS.ProcessEnv = {},
  platform: NodeJS.Platform = 'linux',
): { deps: TokenDeps; calls: Call[] } {
  const calls: Call[] = [];
  const run: ProcessRunner = async (cmd, args, opts) => {
    calls.push({ cmd, args, timeoutMs: opts.timeoutMs });
    return { code: 0, stdout: 'lorem-token\n', stderr: '', durationMs: 1, ...result };
  };
  return { deps: { env, run, platform, cwd: '/tmp' }, calls };
}

async function failure(promise: Promise<unknown>): Promise<SpecrunError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(SpecrunError);
  expect((error as SpecrunError).code).toBe('account-token');
  return error as SpecrunError;
}

describe('resolveToken', () => {
  it('reads an env source', async () => {
    const { deps } = setup({}, { LOREM_VAR: 'lorem-token' });
    expect(await resolveToken(account({ env: 'LOREM_VAR' }), deps)).toBe('lorem-token');
  });

  it.each([undefined, ''])('fails for a missing or empty variable (%j)', async (value) => {
    const { deps } = setup({}, { LOREM_VAR: value });
    const error = await failure(resolveToken(account({ env: 'LOREM_VAR' }), deps));
    expect(error.message).toContain('lorem');
    expect(error.message).toContain('LOREM_VAR');
  });

  it.each([
    ['darwin', '/bin/sh', ['-c', 'get-it']],
    ['linux', '/bin/sh', ['-c', 'get-it']],
    ['win32', 'cmd.exe', ['/d', '/s', '/c', 'get-it']],
  ] as const)('runs a command source on %s', async (platform, cmd, args) => {
    const { deps, calls } = setup({}, {}, platform);
    expect(await resolveToken(account({ command: 'get-it' }), deps)).toBe('lorem-token');
    expect(calls).toEqual([{ cmd, args, timeoutMs: TOKEN_COMMAND_TIMEOUT_MS }]);
  });

  it.each([
    ['a non-zero exit', { code: 1 }],
    ['a timeout', { code: -1 }],
    ['empty stdout', { stdout: '  \n' }],
  ])('fails on %s without leaking stdout', async (_name, result) => {
    const { deps } = setup({ stdout: 'lorem-token', stderr: 'ipsum failed\n', ...result });
    const error = await failure(resolveToken(account({ command: 'get-it' }), deps));
    expect(error.message).not.toContain('lorem-token');
    expect(error.message).toContain('account lorem');
  });

  it('returns null without running anything for the system login', async () => {
    const { deps, calls } = setup();
    expect(await resolveToken(account(null), deps)).toBeNull();
    expect(calls).toEqual([]);
  });
});
