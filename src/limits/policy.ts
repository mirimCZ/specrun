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
