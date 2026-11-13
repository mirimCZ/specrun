import type { RunReporter } from '../runner/reporter.js';
import { clockTime, createEventFormatter, type Segment, type Tone } from './eventLines.js';

export interface LineReporterOptions {
  color: boolean;
  /** Time of tool-use, phase and wait lines; events carry their own `at`. */
  now?: () => Date;
}

export const WAITING_LINE_INTERVAL_MS = 10 * 60_000;

const COLORS: Record<Tone, number> = { red: 31, green: 32, yellow: 33, dim: 2 };

/** Plain log output for non-TTY stdout and `--no-ui`: one line per persisted event and tool use. */
export function createLineReporter(
  write: (text: string) => void,
  options: LineReporterOptions,
): RunReporter {
  const now = options.now ?? ((): Date => new Date());
  const formatter = createEventFormatter();
  let lastWaitLine: number | null = null;

  const paint = (segments: Segment[]): string =>
    segments
      .map(({ text, tone }) =>
        options.color && tone !== undefined ? `\u001b[${COLORS[tone]}m${text}\u001b[0m` : text,
      )
      .join('');
  const line = (at: Date, segments: Segment[]): void =>
    write(`${clockTime(at)} ${paint(segments)}\n`);

  return {
    plan({ spec }) {
      formatter.plan(spec);
    },
    phase(phase) {
      const segments = formatter.phase(phase);
      if (segments !== null) line(now(), segments);
    },
    event(event) {
      if (event.t === 'limit.wait') lastWaitLine = now().getTime();
      const segments = formatter.event(event);
      if (segments !== null) line(new Date(event.at), segments);
    },
    activity({ tool, detail }) {
      line(now(), [{ text: `🔧 ${tool}${detail === '' ? '' : ` ${detail}`}`, tone: 'dim' }]);
    },
    turn: () => undefined,
    waiting({ until, reason }) {
      const at = now();
      if (lastWaitLine !== null && at.getTime() - lastWaitLine < WAITING_LINE_INTERVAL_MS) return;
      lastWaitLine = at.getTime();
      line(at, [
        { text: `⏳ still waiting until ${clockTime(until)} (${reason})`, tone: 'yellow' },
      ]);
    },
    log(level, message) {
      const tone = level === 'error' ? 'red' : level === 'warn' ? 'yellow' : 'dim';
      line(now(), [{ text: message, tone }]);
    },
  };
}
