import type { AccountLimits } from '../config/configSchema.js';
import type { UsageSnapshot } from './usage.js';

export type PauseDecision =
  | { action: 'go' }
  | { action: 'wait'; until: Date; reason: 'session-low' }
  | { action: 'stop'; reason: 'weekly-low'; resetsAt: Date | null };

const RESET_MARGIN_MS = 60_000;
const UNKNOWN_RESET_WAIT_MS = 30 * 60_000;
const PASSED_RESET_WAIT_MS = 5 * 60_000;

/** A minute after the reset; 30 min when it is unknown, 5 min when it has already passed. */
export function waitTarget(resetsAt: Date | null, now: Date): Date {
  if (resetsAt === null) return new Date(now.getTime() + UNKNOWN_RESET_WAIT_MS);
  const target = resetsAt.getTime() + RESET_MARGIN_MS;
  if (target <= now.getTime()) return new Date(now.getTime() + PASSED_RESET_WAIT_MS);
  return new Date(target);
}

/** Wait target after a limit hit inside a session (the 5h window is what blocks the resume). */
export function limitHitTarget(snapshot: UsageSnapshot | null, now: Date): Date {
  return waitTarget(snapshot?.session?.resetsAt ?? null, now);
}

export function decide(
  snapshot: UsageSnapshot | null,
  limits: AccountLimits,
  now: Date,
): PauseDecision {
  if (snapshot === null) return { action: 'go' };
  // Weekly wins: waiting out the session is pointless when the week is nearly used up.
  if (snapshot.weekly && snapshot.weekly.leftPercent < limits.weeklyMinLeft) {
    return { action: 'stop', reason: 'weekly-low', resetsAt: snapshot.weekly.resetsAt };
  }
  if (snapshot.session && snapshot.session.leftPercent < limits.sessionMinLeft) {
    return {
      action: 'wait',
      until: waitTarget(snapshot.session.resetsAt, now),
      reason: 'session-low',
    };
  }
  return { action: 'go' };
}

export type AccountUsage = {
  name: string;
  limits: AccountLimits;
  snapshot: UsageSnapshot | null;
  blockedUntil: Date | null;
};

export type AccountChoice =
  | { action: 'go'; account: string }
  | { action: 'wait'; account: string; until: Date; reason: 'session-low' | 'limit-hit' }
  | { action: 'stop'; reason: 'weekly-low'; resetsAt: Date | null };

export type SwitchReason = 'weekly-low' | 'session-low' | 'limit-hit' | 'priority';

type AccountVerdict =
  | { action: 'go' }
  | { action: 'wait'; until: Date; reason: 'session-low' | 'limit-hit' }
  | { action: 'skip'; resetsAt: Date | null };

function isBlocked(
  account: AccountUsage,
  now: Date,
): account is AccountUsage & { blockedUntil: Date } {
  return account.blockedUntil !== null && account.blockedUntil.getTime() > now.getTime();
}

// Weekly-low comes first (MAD-8): a blocked account that is also out for the week is skipped,
// not waited for.
function judge(account: AccountUsage, now: Date): AccountVerdict {
  const decision = decide(account.snapshot, account.limits, now);
  if (decision.action === 'stop') return { action: 'skip', resetsAt: decision.resetsAt };
  if (isBlocked(account, now)) {
    return { action: 'wait', until: account.blockedUntil, reason: 'limit-hit' };
  }
  return decision;
}

function candidateOrder(
  accounts: readonly AccountUsage[],
  current: string | null,
): readonly AccountUsage[] {
  const sticky = accounts.find((account) => account.name === current);
  if (sticky === undefined) return accounts;
  return [sticky, ...accounts.filter((account) => account !== sticky)];
}

function earliest(dates: readonly (Date | null)[]): Date | null {
  return dates.reduce<Date | null>(
    (min, date) => (date !== null && (min === null || date < min) ? date : min),
    null,
  );
}

/**
 * Picks the account for the next segment: `current` stays as long as it can go (MAD-9),
 * weekly-low accounts are always skipped (MAD-8), and only `burn` moves past an account that
 * merely has to wait (MAD-7, MAD-10).
 */
export function chooseAccount(
  accounts: readonly AccountUsage[],
  options: { burn: boolean; current: string | null },
  now: Date,
): AccountChoice {
  if (accounts.length === 0) throw new Error('chooseAccount needs at least one account');

  const judged = candidateOrder(accounts, options.current).map((account) => ({
    name: account.name,
    verdict: judge(account, now),
  }));

  let bestWait: Extract<AccountChoice, { action: 'wait' }> | null = null;
  for (const { name, verdict } of judged) {
    if (verdict.action === 'skip') continue;
    if (verdict.action === 'go') return { action: 'go', account: name };
    const wait = { ...verdict, account: name };
    if (!options.burn) return wait;
    // Strictly earlier only: ties go to the earlier candidate.
    if (bestWait === null || wait.until < bestWait.until) bestWait = wait;
  }
  if (bestWait !== null) return bestWait;

  const resets = judged.map(({ verdict }) => (verdict.action === 'skip' ? verdict.resetsAt : null));
  return { action: 'stop', reason: 'weekly-low', resetsAt: earliest(resets) };
}

/** Why the runner leaves `from` for another account. */
export function switchReason(from: AccountUsage, now: Date): SwitchReason {
  if (isBlocked(from, now)) return 'limit-hit';
  const decision = decide(from.snapshot, from.limits, now);
  if (decision.action === 'stop') return 'weekly-low';
  if (decision.action === 'wait') return 'session-low';
  return 'priority';
}
