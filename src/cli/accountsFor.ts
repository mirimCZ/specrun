import {
  prepareAccounts,
  type AccountSelection,
  type PreparedAccount,
} from '../accounts/prepare.js';
import type { Config } from '../config/configSchema.js';
import { loadGlobalConfig } from '../config/globalConfig.js';
import { SpecrunError } from '../errors.js';
import { runCommand } from '../process/run.js';
import type { CliDeps } from './cliDeps.js';

/**
 * MAD-15: resolves the tokens of the selected accounts once, before any work starts, and prints
 * the configuration warnings. A token error propagates and ends the command.
 */
export async function accountsFor(
  repoRoot: string,
  config: Config,
  selection: AccountSelection,
  deps: CliDeps,
): Promise<PreparedAccount[]> {
  const prepared = await prepareAccounts(
    { config, global: loadGlobalConfig({ homedir: deps.homedir }), selection },
    { env: deps.env, run: runCommand, platform: process.platform, cwd: repoRoot },
  );
  for (const warning of prepared.warnings) deps.stderr(`warning: ${warning}\n`);
  return prepared.accounts;
}

/** The single account plan / review launch `claude` with: the named one, else the priority one. */
export async function accountForSession(
  repoRoot: string,
  config: Config,
  name: string | undefined,
  deps: CliDeps,
): Promise<PreparedAccount> {
  const [account] = await accountsFor(
    repoRoot,
    config,
    name === undefined ? { kind: 'priority' } : { kind: 'pinned', name },
    deps,
  );
  if (account === undefined) {
    throw new SpecrunError('account-unknown', 'no account');
  }
  return account;
}
