import type { AccountLimits, Config } from '../config/configSchema.js';
import type { GlobalConfig } from '../config/globalConfig.js';
import { SpecrunError } from '../errors.js';
import { resolveAccounts, type Account } from './accounts.js';
import { accountEnv, type ChildEnv } from './env.js';
import { resolveToken, type TokenDeps } from './token.js';

export type AccountSelection =
  { kind: 'all' } | { kind: 'priority' } | { kind: 'pinned'; name: string };

export type PreparedAccount = { name: string; limits: AccountLimits; env: ChildEnv | null };

function select(accounts: Account[], selection: AccountSelection): Account[] {
  switch (selection.kind) {
    case 'all':
      return accounts;
    case 'priority':
      return accounts.slice(0, 1);
    case 'pinned': {
      const found = accounts.find((account) => account.name === selection.name);
      if (!found) {
        const names = accounts.map((account) => account.name).join(', ');
        throw new SpecrunError('account-unknown', `unknown account "${selection.name}"`, [
          `configured accounts: ${names}`,
        ]);
      }
      return [found];
    }
  }
}

export async function prepareAccounts(
  input: { config: Config; global: GlobalConfig; selection: AccountSelection },
  deps: TokenDeps,
): Promise<{ accounts: PreparedAccount[]; warnings: string[] }> {
  const resolved = resolveAccounts(input.config, input.global);
  const accounts: PreparedAccount[] = [];
  for (const account of select(resolved.accounts, input.selection)) {
    const token = await resolveToken(account, deps);
    accounts.push({ name: account.name, limits: account.limits, env: accountEnv(deps.env, token) });
  }
  return { accounts, warnings: resolved.warnings };
}
