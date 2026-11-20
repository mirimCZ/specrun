import { describe, expect, it } from 'vitest';
import { ConfigSchema, type Config } from '../config/configSchema.js';
import type { GlobalConfig } from '../config/globalConfig.js';
import { IMPLICIT_ACCOUNT, resolveAccounts } from './accounts.js';

const verify = [{ name: 'test', command: 'npm test' }];

function repoConfig(limits: unknown = {}): Config {
  return ConfigSchema.parse({ verify, limits });
}

describe('resolveAccounts', () => {
  it('returns only the implicit account with the repo limits without global accounts', () => {
    const config = repoConfig({ sessionMinLeft: 25 });
    expect(resolveAccounts(config, { accounts: [] })).toEqual({
      accounts: [
        { name: IMPLICIT_ACCOUNT, token: null, limits: { sessionMinLeft: 25, weeklyMinLeft: 5 } },
      ],
      warnings: [],
    });
  });

  it('keeps the order of the global config and maps a missing token to null', () => {
    const global: GlobalConfig = {
      accounts: [{ name: 'lorem', token: { env: 'LOREM_TOKEN' } }, { name: 'ipsum' }],
    };
    const { accounts } = resolveAccounts(repoConfig(), global);
    expect(accounts.map((account) => account.name)).toEqual(['lorem', 'ipsum']);
    expect(accounts.map((account) => account.token)).toEqual([{ env: 'LOREM_TOKEN' }, null]);
  });

  describe('limit precedence (per field)', () => {
    it('uses the defaults when nothing is set', () => {
      const { accounts } = resolveAccounts(repoConfig(), { accounts: [{ name: 'lorem' }] });
      expect(accounts[0]?.limits).toEqual({ sessionMinLeft: 15, weeklyMinLeft: 5 });
    });

    it('repo limits win over the defaults', () => {
      const config = repoConfig({ weeklyMinLeft: 8 });
      const { accounts } = resolveAccounts(config, { accounts: [{ name: 'lorem' }] });
      expect(accounts[0]?.limits).toEqual({ sessionMinLeft: 15, weeklyMinLeft: 8 });
    });

    it('global account limits win over the repo limits', () => {
      const config = repoConfig({ sessionMinLeft: 20, weeklyMinLeft: 8 });
      const global: GlobalConfig = {
        accounts: [{ name: 'lorem', limits: { sessionMinLeft: 30 } }],
      };
      const { accounts } = resolveAccounts(config, global);
      expect(accounts[0]?.limits).toEqual({ sessionMinLeft: 30, weeklyMinLeft: 8 });
    });

    it('repo account overrides win over the global account limits', () => {
      const config = repoConfig({
        sessionMinLeft: 20,
        weeklyMinLeft: 8,
        accounts: { lorem: { weeklyMinLeft: 2 } },
      });
      const global: GlobalConfig = {
        accounts: [
          { name: 'lorem', limits: { sessionMinLeft: 30, weeklyMinLeft: 12 } },
          { name: 'ipsum', limits: { weeklyMinLeft: 12 } },
        ],
      };
      const { accounts } = resolveAccounts(config, global);
      expect(accounts[0]?.limits).toEqual({ sessionMinLeft: 30, weeklyMinLeft: 2 });
      expect(accounts[1]?.limits).toEqual({ sessionMinLeft: 20, weeklyMinLeft: 12 });
    });
  });

  it('warns once about an override for an unknown account when accounts exist', () => {
    const config = repoConfig({ accounts: { lorem: {}, dolor: { sessionMinLeft: 1 } } });
    const { warnings } = resolveAccounts(config, { accounts: [{ name: 'lorem' }] });
    expect(warnings).toEqual(['limits.accounts.dolor: no such account in ~/.specrun/config.json']);
  });

  it('does not warn about overrides without global accounts', () => {
    const config = repoConfig({ accounts: { dolor: { sessionMinLeft: 1 } } });
    expect(resolveAccounts(config, { accounts: [] }).warnings).toEqual([]);
  });
});
