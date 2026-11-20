import type { SpecrunEvent } from '../events/eventSchema.js';
import { formatTokens, formatUsd } from '../progress/renderProgress.js';
import type { RunPhase } from '../runner/reporter.js';
import type { Spec } from '../spec/specSchema.js';

/** Events without an account (or on `default`) render as before multi-account support. */
function otherAccount(account: string | undefined): string | null {
  return account === undefined || account === DEFAULT_ACCOUNT ? null : account;
}

const DEFAULT_ACCOUNT = 'default';

export type Tone = 'red' | 'green' | 'yellow' | 'dim';

/** A piece of a log line; the line reporter paints it with ANSI, the dashboard with `<Text>`. */
export interface Segment {
  text: string;
  tone?: Tone;
}

export interface EventFormatter {
  plan(spec: Spec): void;
  event(event: SpecrunEvent): Segment[] | null;
  /** Only the phases no event announces get a line; the rest show in the dashboard only. */
  phase(phase: RunPhase): Segment[] | null;
}

interface TaskTally {
  turns: number;
  peak: number;
  cost: number;
}

export function clockTime(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** `session 90 % left · resets 06:30 · weekly 63 % left`; null windows are left out. */
export function usageText(usage: {
  sessionLeft: number | null;
  sessionResetsAt: Date | null;
  weeklyLeft: number | null;
}): string {
  const parts: string[] = [];
  if (usage.sessionLeft !== null) parts.push(`session ${Math.round(usage.sessionLeft)} % left`);
  if (usage.sessionResetsAt !== null) {
    parts.push(`resets ${clockTime(usage.sessionResetsAt).slice(0, 5)}`);
  }
  if (usage.weeklyLeft !== null) parts.push(`weekly ${Math.round(usage.weeklyLeft)} % left`);
  return parts.length === 0 ? 'unknown' : parts.join(' · ');
}

/** `14s`, `2m 05s`: verify steps take seconds to minutes. */
export function stepDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

const one = (text: string, tone?: Tone): Segment[] => [
  tone === undefined ? { text } : { text, tone },
];

/** Milestone lines of a run, shared by the line reporter and the dashboard's log. */
export function createEventFormatter(): EventFormatter {
  const tallies = new Map<string, TaskTally>();
  const titles = new Map<string, string>();

  return {
    plan(spec) {
      for (const task of spec.tasks) titles.set(task.id, task.title);
    },
    phase(phase) {
      switch (phase.kind) {
        case 'worktree':
          return one(`creating worktree ${phase.path}`);
        case 'setup':
          return one(`setup: ${phase.command}`);
        case 'checkout':
          return one(`switching the checkout to ${phase.branch}`);
        // A check can take minutes; without this line the log sits on "reported complete".
        case 'verify':
          return one(`verify ${phase.task} round ${phase.round}: ${phase.steps.join(' → ')} …`);
        case 'verify-step': {
          const { name, ok, durationMs } = phase.finished;
          const took = stepDuration(durationMs);
          return [
            { text: `verify ${phase.task} ${name}: ` },
            ok
              ? { text: `ok (${took})`, tone: 'green' }
              : { text: `failed (${took})`, tone: 'red' },
          ];
        }
        default:
          return null;
      }
    },
    event(event) {
      switch (event.t) {
        case 'run.started':
          return one(`run started: ${event.spec} on ${event.branch}`);
        case 'run.finished': {
          const message = event.message === undefined ? '' : ` — ${event.message}`;
          return one(`run finished: ${event.reason}${message}`);
        }
        case 'session.started': {
          const title = titles.get(event.task);
          const name = title === undefined ? event.task : `${event.task} ${title}`;
          const account = otherAccount(event.account);
          const on = account === null ? '' : ` on ${account}`;
          return one(`▶ ${name} (${event.reason}, ${event.model})${on}`);
        }
        case 'session.finished': {
          const tally = tallies.get(event.task) ?? { turns: 0, peak: 0, cost: 0 };
          tallies.set(event.task, {
            turns: tally.turns + event.turns,
            peak: Math.max(tally.peak, event.peakContext),
            cost: tally.cost + event.costUsd,
          });
          const error = event.error === undefined ? '' : `: ${event.error}`;
          return one(`■ ${event.task} session ended (${event.outcome}${error})`);
        }
        case 'task.completed':
          return one(
            `${event.task} reported complete: ${event.payload.summary.split('\n')[0] ?? ''}`,
          );
        case 'verify.finished': {
          const failed = event.steps.filter((step) => !step.ok).map((step) => step.name);
          return [
            { text: `verify ${event.task} round ${event.round}: ` },
            event.ok
              ? { text: 'ok', tone: 'green' }
              : { text: `failed (${failed.join(', ')})`, tone: 'red' },
          ];
        }
        case 'task.committed': {
          const t = tallies.get(event.task) ?? { turns: 0, peak: 0, cost: 0 };
          const stats = `${t.turns} turns · peak ${formatTokens(t.peak)} · ${formatUsd(t.cost)}`;
          return [
            { text: `✔ ${event.task} committed ${event.commit.slice(0, 7)}`, tone: 'green' },
            { text: ` · ${stats}` },
          ];
        }
        case 'task.blocked':
          return one(`✖ ${event.task} blocked (${event.source}): ${event.reason}`, 'red');
        case 'limit.wait': {
          const account = otherAccount(event.account);
          const who = account === null ? '' : `${account} `;
          return one(
            `⏳ ${who}waiting until ${clockTime(new Date(event.until))} (${event.reason})`,
            'yellow',
          );
        }
        case 'account.switched':
          return one(
            `⇄ ${event.task} account ${event.from} → ${event.to} (${event.reason})`,
            'yellow',
          );
        case 'usage.snapshot': {
          const account = otherAccount(event.account);
          return one(
            `usage${account === null ? '' : ` ${account}`}: ${usageText({
              sessionLeft: event.sessionLeft,
              sessionResetsAt:
                event.sessionResetsAt === null ? null : new Date(event.sessionResetsAt),
              weeklyLeft: event.weeklyLeft,
            })}`,
            'dim',
          );
        }
        case 'budget.exceeded':
          return one(
            `! ${event.task} over budget (${event.turns} turns, ${formatUsd(event.costUsd)})`,
            'yellow',
          );
        case 'protocol.violation':
          return one(`! ${event.task} protocol violation: ${event.detail}`, 'yellow');
        default:
          return null;
      }
    },
  };
}
