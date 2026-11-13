import { Box, Static, Text } from 'ink';
import type { ReactElement } from 'react';
import { clockTime, usageText, type Segment, type Tone } from '../cli/eventLines.js';
import type { DashboardView, LogLine } from './dashboardStore.js';
import { TaskRow } from './TaskRow.js';

export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
const MAX_WIDTH = 100;
const TONE_COLORS: Record<Exclude<Tone, 'dim'>, string> = {
  red: 'red',
  green: 'green',
  yellow: 'yellow',
};

/** `12s`, `6m 12s`, `1h 02m`: seconds matter while watching, not after an hour. */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

function SegmentText({ segment }: { segment: Segment }): ReactElement {
  if (segment.tone === undefined) return <Text>{segment.text}</Text>;
  if (segment.tone === 'dim') return <Text dimColor>{segment.text}</Text>;
  return <Text color={TONE_COLORS[segment.tone]}>{segment.text}</Text>;
}

function LogRow({ line }: { line: LogLine }): ReactElement {
  return (
    <Text>
      {clockTime(line.at)}{' '}
      {line.segments.map((segment, i) => (
        <SegmentText key={i} segment={segment} />
      ))}
    </Text>
  );
}

function header(view: DashboardView, now: Date, frame: number): string {
  const parts: string[] = [view.title ?? 'specrun'];
  if (view.phaseNumber !== null) parts.push(`phase ${view.phaseNumber}`);
  if (view.total > 0) parts.push(`${view.done}/${view.total} done`);
  if (view.activity !== null) {
    const since = view.running?.since ?? view.activity.since;
    const spinner = SPINNER[frame % SPINNER.length] ?? '';
    parts.push(`${spinner} ${view.activity.label}`, formatElapsed(now.getTime() - since.getTime()));
  }
  return parts.join(' · ');
}

function footer(view: DashboardView, now: Date): { text: string; color?: string } {
  if (view.waiting !== null) {
    const left = formatElapsed(view.waiting.until.getTime() - now.getTime());
    const until = clockTime(view.waiting.until).slice(0, 5);
    return {
      text: `⏳ waiting until ${until} (${view.waiting.reason}) · ${left} left`,
      color: 'yellow',
    };
  }
  return { text: view.usage === null ? 'usage unknown' : usageText(view.usage) };
}

export interface ControlState {
  /** The dashboard reads keys (stdin supports raw mode); else Ctrl+C arrives as SIGINT. */
  keys: boolean;
  stopRequested: boolean;
}

/** Hint while running; once a stop was asked for, a prominent line that it is pending. */
function controlLine(
  view: DashboardView,
  control: ControlState,
): { text: string; pending: boolean } | null {
  if (view.activity === null) return null;
  if (control.stopRequested) {
    const what =
      view.running === null
        ? 'stopping before the next task'
        : `stopping after ${view.running.task} finishes`;
    const cancel = control.keys ? ' · c cancel' : '';
    return { text: `⏹ ${what}${cancel} · Ctrl+C interrupt now`, pending: true };
  }
  return {
    text: control.keys
      ? 's / Ctrl+C stop after this task · Ctrl+C twice interrupt now'
      : 'Ctrl+C stop after this task · twice interrupt now',
    pending: false,
  };
}

export interface DashboardProps {
  view: DashboardView;
  control: ControlState;
  now: Date;
  /** Spinner frame; advances with the render tick. */
  frame: number;
  /** Terminal columns. */
  width: number;
}

/** Milestone log above a live box: task rows, the running task's tool call, usage or the wait. */
export function Dashboard({ view, control, now, frame, width }: DashboardProps): ReactElement {
  const idWidth = Math.max(0, ...view.rows.map((row) => row.id.length));
  const boxWidth = Math.min(width, MAX_WIDTH);
  const bottom = footer(view, now);
  const controls = controlLine(view, control);
  return (
    <Box flexDirection="column">
      <Static items={view.log}>{(line) => <LogRow key={line.id} line={line} />}</Static>
      <Box flexDirection="column" borderStyle="round" paddingX={1} width={boxWidth}>
        <Text bold wrap="truncate-end">
          {header(view, now, frame)}
        </Text>
        {view.rows.map((row) => (
          <Box key={row.id} flexDirection="column">
            <TaskRow row={row} idWidth={idWidth} />
            {row.status === 'running' && view.tool !== null ? (
              <Box>
                <Text dimColor>{'  🔧 '}</Text>
                {/* Long paths lose their start, so the file name stays visible. */}
                <Box flexShrink={1}>
                  <Text dimColor wrap="truncate-start">
                    {view.tool}
                  </Text>
                </Box>
              </Box>
            ) : null}
          </Box>
        ))}
        <Text dimColor>{'─'.repeat(Math.max(0, boxWidth - 4))}</Text>
        <Text wrap="truncate-end" {...(bottom.color === undefined ? {} : { color: bottom.color })}>
          {bottom.text}
        </Text>
        {controls === null ? null : controls.pending ? (
          <Text bold color="yellow" wrap="truncate-end">
            {controls.text}
          </Text>
        ) : (
          <Text dimColor wrap="truncate-end">
            {controls.text}
          </Text>
        )}
      </Box>
    </Box>
  );
}
