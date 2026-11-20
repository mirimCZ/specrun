import { describe, expect, it } from 'vitest';
import { ConfigSchema } from '../config/configSchema.js';
import type { GlobalConfig } from '../config/globalConfig.js';
import type { ProcessRunner } from '../process/run.js';
import { prepareAccounts, type AccountSelection } from './prepare.js';

const config = ConfigSchema.parse({
  verify: [{ name: 'ok', command: 'true' }],
  limits: { accounts: { missing: { sessionMinLeft: 1 } } },
});
const global: GlobalConfig = {
  accounts: [
    { name: 'one', token: { command: 'tok-one' } },
    { name: 'two', token: { command: 'tok-two' } },
  ],
};

function setup(): { commands: string[]; deps: Parameters<typeof prepareAccounts>[1] } {
  const commands: string[] = [];
  const run: ProcessRunner = async (_cmd, args) => {
    commands.push(args.at(-1) ?? '');
    return { code: 0, stdout: 'lorem-token', stderr: '', durationMs: 1 };
  };
  return { commands, deps: { env: { LOREM: 'ipsum' }, run, platform: 'linux', cwd: '/tmp' } };
}

const prepare = (selection: AccountSelection, g: GlobalConfig = global) => {
  const { commands, deps } = setup();
  return prepareAccounts({ config, global: g, selection }, deps).then((r) => ({ ...r, commands }));
};

describe('prepareAccounts', () => {
  it('keeps the priority order for all', async () => {
    const { accounts, commands } = await prepare({ kind: 'all' });
    expect(accounts.map((a) => a.name)).toEqual(['one', 'two']);
    expect(commands).toEqual(['tok-one', 'tok-two']);
    expect(accounts[0]?.env?.['CLAUDE_CODE_OAUTH_TOKEN']).toBe('lorem-token');
  });

  it('resolves only the first account for priority', async () => {
    const { accounts, commands } = await prepare({ kind: 'priority' });
    expect(accounts.map((a) => a.name)).toEqual(['one']);
    expect(commands).toEqual(['tok-one']);
  });

  it('selects a pinned account', async () => {
    const { accounts, commands } = await prepare({ kind: 'pinned', name: 'two' });
    expect(accounts.map((a) => a.name)).toEqual(['two']);
    expect(commands).toEqual(['tok-two']);
  });

  it('rejects an unknown pinned name listing the names', async () => {
    const error = await prepare({ kind: 'pinned', name: 'nope' }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'account-unknown' });
    expect((error as Error).message).toContain('one, two');
  });

  it('passes warnings through', async () => {
    const { warnings } = await prepare({ kind: 'all' });
    expect(warnings).toEqual([expect.stringContaining('missing')]);
  });

  it('gives one default account without env when no global accounts exist', async () => {
    const { accounts, commands } = await prepare({ kind: 'all' }, { accounts: [] });
    expect(accounts).toEqual([{ name: 'default', limits: expect.any(Object), env: null }]);
    expect(commands).toEqual([]);
  });
});
