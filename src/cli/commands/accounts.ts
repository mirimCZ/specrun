import type { Command } from 'commander';
import { resolveAccounts, type Account } from '../../accounts/accounts.js';
import { accountEnv, type ChildEnv } from '../../accounts/env.js';
import { resolveToken, type TokenDeps } from '../../accounts/token.js';
import { findRepoRoot, loadConfig } from '../../config/loadConfig.js';
import { loadGlobalConfig } from '../../config/globalConfig.js';
import { SpecrunError } from '../../errors.js';
import type { UsageSnapshot, UsageWindow } from '../../limits/usage.js';
import { runCommand } from '../../process/run.js';
import { probeUsage } from '../../session/probeUsage.js';
import type { CliDeps } from '../cliDeps.js';
import { table } from '../table.js';

/** Seams for tests: the token resolver and the usage probe. */
export interface AccountsCommandOverrides {
  setExitCode?: (code: number) => void;
  resolveToken?: (account: Account, deps: TokenDeps) => Promise<string | null>;
  probe?: (input: { cwd: string; env: ChildEnv | null }) => Promise<UsageSnapshot | null>;
}

type Outcome = { kind: 'ok'; snapshot: UsageSnapshot } | { kind: 'failed'; text: string };

function sourceLabel(account: Account): string {
  if (account.token === null) return 'system login';
  return 'env' in account.token ? `env ${account.token.env}` : 'command';
}

function windowCell(window: UsageWindow | null, now: Date): [string, string] {
  if (window === null) return ['n/a', ''];
  const left = `${Math.round(window.leftPercent)}% left`;
  if (window.resetsAt === null) return [left, ''];
  const minutes = Math.max(0, Math.round((window.resetsAt.getTime() - now.getTime()) / 60_000));
  const reset =
    minutes >= 60 * 24
      ? `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`
      : minutes >= 60
        ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
        : `${minutes}m`;
  return [left, `resets in ${reset}`];
}

async function check(
  account: Account,
  deps: TokenDeps,
  cwd: string,
  overrides: AccountsCommandOverrides,
): Promise<Outcome> {
  let env: ChildEnv | null;
  try {
    const token = await (overrides.resolveToken ?? resolveToken)(account, deps);
    env = accountEnv(deps.env, token);
  } catch (error) {
    if (error instanceof SpecrunError && error.code === 'account-token') {
      return { kind: 'failed', text: `token error: ${error.message}` };
    }
    throw error;
  }
  const probe =
    overrides.probe ??
    ((input) => probeUsage({ cwd: input.cwd, ...(input.env === null ? {} : { env: input.env }) }));
  const snapshot = await probe({ cwd, env }).catch(() => null);
  return snapshot === null ? { kind: 'failed', text: 'probe failed' } : { kind: 'ok', snapshot };
}

export function register(
  program: Command,
  deps: CliDeps,
  overrides: AccountsCommandOverrides = {},
): void {
  program
    .command('accounts')
    .description('List the Claude accounts in priority order and check each one')
    .action(async () => {
      const repoRoot = findRepoRoot(deps.cwd);
      const config = loadConfig(repoRoot);
      const resolved = resolveAccounts(config, loadGlobalConfig({ homedir: deps.homedir }));
      for (const warning of resolved.warnings) deps.stderr(`warning: ${warning}\n`);
      const tokenDeps: TokenDeps = {
        env: deps.env,
        run: runCommand,
        platform: process.platform,
        cwd: repoRoot,
      };
      const outcomes = await Promise.all(
        resolved.accounts.map((account) => check(account, tokenDeps, repoRoot, overrides)),
      );
      const now = deps.now();
      const rows = resolved.accounts.map((account, index) => {
        const { sessionMinLeft: s, weeklyMinLeft: w } = account.limits;
        const head = [account.name, sourceLabel(account), `${s}/${w}`];
        const outcome = outcomes[index];
        if (outcome === undefined || outcome.kind === 'failed') {
          return [...head, outcome?.text ?? 'probe failed'];
        }
        const [sessionLeft, sessionReset] = windowCell(outcome.snapshot.session, now);
        const [weekLeft, weekReset] = windowCell(outcome.snapshot.weekly, now);
        return [...head, `5h ${sessionLeft}`, sessionReset, `week ${weekLeft}`, weekReset];
      });
      deps.stdout(`${table(rows)}\n`);
      if (outcomes.some((outcome) => outcome.kind === 'failed')) {
        (overrides.setExitCode ?? ((code) => void (process.exitCode = code)))(1);
      }
    });
}
