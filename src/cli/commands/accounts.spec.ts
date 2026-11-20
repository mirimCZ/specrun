import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureDeps, makeTempRepo, writeDemoSpec } from '../../../test/fixtures/specRepo.js';
import { SpecrunError } from '../../errors.js';
import type { UsageSnapshot } from '../../limits/usage.js';
import { Command } from 'commander';
import { register, type AccountsCommandOverrides } from './accounts.js';

let dir: string;
beforeEach(() => {
  dir = makeTempRepo();
  writeDemoSpec(dir);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const NOW = new Date('2026-01-01T10:00:00.000Z');
const snapshot = (session: number, weekly: number): UsageSnapshot => ({
  session: { leftPercent: session, resetsAt: new Date(NOW.getTime() + 90 * 60_000) },
  weekly: { leftPercent: weekly, resetsAt: new Date(NOW.getTime() + 3 * 86_400_000) },
  source: 'probe',
  at: NOW,
  rejected: false,
});

function writeGlobal(config: unknown): void {
  const home = captureDeps(dir).homedir();
  mkdirSync(join(home, '.specrun'), { recursive: true });
  writeFileSync(join(home, '.specrun', 'config.json'), JSON.stringify(config));
}

async function accounts(
  overrides: AccountsCommandOverrides,
): Promise<{ out: string; exit: number[] }> {
  const deps = captureDeps(dir);
  const exit: number[] = [];
  const program = new Command('specrun');
  register(program, deps, { setExitCode: (code) => void exit.push(code), ...overrides });
  await program.parseAsync(['node', 'specrun', 'accounts']);
  return { out: deps.out.join(''), exit };
}

describe('specrun accounts', () => {
  it('lists the accounts in priority order with their usage', async () => {
    writeGlobal({
      accounts: [{ name: 'lorem', token: { env: 'LOREM_TOKEN' } }, { name: 'ipsum' }],
    });
    const seen: boolean[] = [];
    const { out, exit } = await accounts({
      resolveToken: (account) => Promise.resolve(account.token === null ? null : 'lorem-token'),
      probe: ({ env }) => {
        seen.push(env !== null);
        return Promise.resolve(env === null ? snapshot(10, 20) : snapshot(80, 60));
      },
    });
    const lines = out.trim().split('\n');
    expect(lines[0]).toMatch(
      /^lorem\s+env LOREM_TOKEN\s+15\/5\s+5h 80% left\s+resets in 1h 30m\s+week 60% left\s+resets in 3d 0h/,
    );
    expect(lines[1]).toMatch(/^ipsum\s+system login\s+15\/5\s+5h 10% left/);
    expect(seen.sort()).toEqual([false, true]);
    expect(exit).toEqual([]);
    expect(out).not.toContain('lorem-token');
  });

  it('shows a token error, probes the others and exits 1', async () => {
    writeGlobal({
      accounts: [{ name: 'lorem', token: { env: 'LOREM_TOKEN' } }, { name: 'ipsum' }],
    });
    const { out, exit } = await accounts({
      resolveToken: (account) =>
        account.token === null
          ? Promise.resolve(null)
          : Promise.reject(new SpecrunError('account-token', 'account lorem: variable missing')),
      probe: () => Promise.resolve(snapshot(50, 50)),
    });
    const lines = out.trim().split('\n');
    expect(lines[0]).toMatch(/^lorem .*token error: account lorem: variable missing/);
    expect(lines[1]).toMatch(/^ipsum .*5h 50% left/);
    expect(exit).toEqual([1]);
  });

  it('reports a failed probe', async () => {
    const { out, exit } = await accounts({ probe: () => Promise.resolve(null) });
    expect(out).toMatch(/probe failed/);
    expect(exit).toEqual([1]);
  });

  it('shows one default account without a global config', async () => {
    const { out, exit } = await accounts({ probe: () => Promise.resolve(snapshot(70, 40)) });
    expect(out.trim().split('\n')).toHaveLength(1);
    expect(out).toMatch(/^default\s+system login/);
    expect(exit).toEqual([]);
  });
});
