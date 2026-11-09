import type { SpecrunEvent } from '../events/eventSchema.js';
import { formatTokens, formatUsd } from '../progress/renderProgress.js';
import type { RunReporter } from '../runner/reporter.js';

export interface LineReporterOptions {
  color: boolean;
  /** Time of tool-use and wait lines; events carry their own `at`. */
  now?: () => Date;
}

export const WAITING_LINE_INTERVAL_MS = 10 * 60_000;

interface TaskTally {
  turns: number;
  peak: number;
  cost: number;
}

const COLORS = { red: 31, green: 32, yellow: 33, dim: 2 } as const;

function clock(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Plain log output for non-TTY stdout and `--no-ui`: one line per persisted event and tool use. */
export function createLineReporter(
  write: (text: string) => void,
  options: LineReporterOptions,
): RunReporter {
  const now = options.now ?? ((): Date => new Date());
  const tallies = new Map<string, TaskTally>();
  let lastWaitLine: number | null = null;

  const paint = (color: keyof typeof COLORS, text: string): string =>
    options.color ? `\u001b[${COLORS[color]}m${text}\u001b[0m` : text;
  const line = (at: Date, text: string): void => write(`${clock(at)} ${text}\n`);

  const describe = (event: SpecrunEvent): string | null => {
    switch (event.t) {
      case 'run.started':
        return `run started: ${event.spec} on ${event.branch}`;
      case 'run.finished': {
        const message = event.message === undefined ? '' : ` — ${event.message}`;
        return `run finished: ${event.reason}${message}`;
      }
      case 'session.started':
        return `▶ ${event.task} session (${event.reason}, ${event.model})`;
      case 'session.finished': {
        const tally = tallies.get(event.task) ?? { turns: 0, peak: 0, cost: 0 };
        tallies.set(event.task, {
          turns: tally.turns + event.turns,
          peak: Math.max(tally.peak, event.peakContext),
          cost: tally.cost + event.costUsd,
        });
        const error = event.error === undefined ? '' : `: ${event.error}`;
        return `■ ${event.task} session ended (${event.outcome}${error})`;
      }
      case 'task.completed':
        return `${event.task} reported complete: ${event.payload.summary.split('\n')[0] ?? ''}`;
      case 'verify.finished': {
        const failed = event.steps.filter((step) => !step.ok).map((step) => step.name);
        const result = event.ok
          ? paint('green', 'ok')
          : paint('red', `failed (${failed.join(', ')})`);
        return `verify ${event.task} round ${event.round}: ${result}`;
      }
      case 'task.committed': {
        const t = tallies.get(event.task) ?? { turns: 0, peak: 0, cost: 0 };
        const stats = `${t.turns} turns · peak ${formatTokens(t.peak)} · ${formatUsd(t.cost)}`;
        return `${paint('green', `✔ ${event.task} committed ${event.commit.slice(0, 7)}`)} · ${stats}`;
      }
      case 'task.blocked':
        return paint('red', `✖ ${event.task} blocked (${event.source}): ${event.reason}`);
      case 'limit.wait':
        lastWaitLine = now().getTime();
        return paint(
          'yellow',
          `⏳ waiting until ${clock(new Date(event.until))} (${event.reason})`,
        );
      case 'budget.exceeded':
        return paint(
          'yellow',
          `! ${event.task} over budget (${event.turns} turns, ${formatUsd(event.costUsd)})`,
        );
      case 'protocol.violation':
        return paint('yellow', `! ${event.task} protocol violation: ${event.detail}`);
      default:
        return null;
    }
  };

  return {
    event(event) {
      const text = describe(event);
      if (text !== null) line(new Date(event.at), text);
    },
    activity({ tool, detail }) {
      line(now(), paint('dim', `🔧 ${tool}${detail === '' ? '' : ` ${detail}`}`));
    },
    turn: () => undefined,
    waiting({ until, reason }) {
      const at = now();
      if (lastWaitLine !== null && at.getTime() - lastWaitLine < WAITING_LINE_INTERVAL_MS) return;
      lastWaitLine = at.getTime();
      line(at, paint('yellow', `⏳ still waiting until ${clock(until)} (${reason})`));
    },
    log(level, message) {
      const color = level === 'error' ? 'red' : level === 'warn' ? 'yellow' : 'dim';
      line(now(), paint(color, message));
    },
  };
}
