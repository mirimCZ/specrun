import type { AccountLimits, Config } from '../config/configSchema.js';
import { GLOBAL_CONFIG_FILE, type GlobalConfig, type TokenSource } from '../config/globalConfig.js';

/** The only account when the global config defines none; it uses the system login (MAD-6). */
export const IMPLICIT_ACCOUNT = 'default';

export type Account = {
  name: string;
  /** null: the system login of Claude Code. */
  token: TokenSource | null;
  limits: AccountLimits;
};

export interface ResolvedAccounts {
  /** Priority order (MAD-4). */
  accounts: Account[];
  warnings: string[];
}

type PartialLimits = { [Field in keyof AccountLimits]?: number | undefined };

/** Per field, the first level that sets it wins; `base` always sets both (MAD-3). */
function mergeLimits(base: AccountLimits, ...levels: (PartialLimits | undefined)[]): AccountLimits {
  const pick = (field: keyof AccountLimits): number =>
    levels.find((level) => level?.[field] !== undefined)?.[field] ?? base[field];
  return { sessionMinLeft: pick('sessionMinLeft'), weeklyMinLeft: pick('weeklyMinLeft') };
}

export function resolveAccounts(config: Config, global: GlobalConfig): ResolvedAccounts {
  const { accounts: overrides, sessionMinLeft, weeklyMinLeft } = config.limits;
  const repoLimits: AccountLimits = { sessionMinLeft, weeklyMinLeft };

  if (global.accounts.length === 0) {
    // Overrides are ignored silently: a repo may target accounts a machine doesn't define (MAD-17).
    return {
      accounts: [{ name: IMPLICIT_ACCOUNT, token: null, limits: repoLimits }],
      warnings: [],
    };
  }

  const accounts = global.accounts.map((account): Account => ({
    name: account.name,
    token: account.token ?? null,
    limits: mergeLimits(repoLimits, overrides[account.name], account.limits),
  }));
  const known = new Set(accounts.map((account) => account.name));
  const warnings = Object.keys(overrides)
    .filter((name) => !known.has(name))
    .map((name) => `limits.accounts.${name}: no such account in ~/${GLOBAL_CONFIG_FILE}`);
  return { accounts, warnings };
}
