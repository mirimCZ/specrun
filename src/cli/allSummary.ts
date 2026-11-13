import type { AllPlan, RunAllResult, SpecSummary } from '../runner/runAll.js';
import { formatElapsed } from '../ui/Dashboard.js';

const REASONS: Record<string, string> = {
  'paused-weekly': 'paused: weekly limit',
  interrupted: 'interrupted',
  stopped: 'stopped on request',
  failed: 'failed',
};

function resultLabel(summary: SpecSummary): string {
  const { outcome, tasks } = summary;
  switch (outcome.kind) {
    case 'ran':
      if (outcome.result.reason !== 'done')
        return REASONS[outcome.result.reason] ?? outcome.result.reason;
      return tasks.done === tasks.total ? 'done' : 'blocked tasks';
    case 'skipped':
      return outcome.reason === 'done' ? 'already done' : 'waits for blocked tasks';
    case 'not-run':
      return 'not run';
    case 'failed':
      return `failed: ${outcome.message.split('\n')[0] ?? ''}`;
  }
}

/** SRD-31: one row per spec, the header first. */
export function summaryRows(specs: readonly SpecSummary[]): string[][] {
  return [
    ['spec', 'result', 'tasks', 'blocked', 'cost', 'time'],
    ...specs.map((summary) => {
      const ran = summary.outcome.kind === 'ran' || summary.outcome.kind === 'failed';
      return [
        summary.spec,
        resultLabel(summary),
        `${summary.tasks.done}/${summary.tasks.total}`,
        summary.tasks.blocked > 0 ? String(summary.tasks.blocked) : '',
        ran ? `$${summary.costUsd.toFixed(2)}` : '',
        ran ? formatElapsed(summary.durationMs) : '',
      ];
    }),
  ];
}

/** The summary file under `.specrun/logs/all/`, so an overnight result outlives the scrollback. */
export function summaryMarkdown(result: RunAllResult, at: Date, base: string): string {
  const [header = [], ...rows] = summaryRows(result.specs);
  const line = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`;
  const merged =
    result.merged > 0 ? `Merged ${result.merged} commit(s) of \`${base}\` first.\n\n` : '';
  const end = result.message === undefined ? '' : `\n${result.message}\n`;
  return [
    `# specrun run --all — ${at.toISOString()}\n`,
    `${merged}${line(header)}`,
    line(header.map(() => '---')),
    ...rows.map(line),
    `\nExit code ${result.exitCode}.${end}`,
  ].join('\n');
}

/** `run --all --dry-run`. */
export function planLines(plan: AllPlan, base: string): string[] {
  const lines: string[] = [];
  let next = 1;
  for (const entry of plan.specs) {
    if (entry.kind === 'invalid') {
      lines.push(`     ${entry.spec}: invalid — ${entry.problem}`);
      continue;
    }
    const { done, total, blocked } = entry.tasks;
    const state = `${done}/${total} done${blocked > 0 ? `, ${blocked} blocked` : ''}`;
    if (entry.kind === 'todo') {
      lines.push(
        `  ${String(next).padStart(2)}. ${entry.spec}: ${state}, ${entry.runnable} runnable`,
      );
      next += 1;
    } else {
      const why = entry.kind === 'done' ? 'skipped (done)' : 'skipped (waits for blocked tasks)';
      lines.push(`     ${entry.spec}: ${state} — ${why}`);
    }
  }
  lines.push(
    plan.baseCommits === null
      ? `specrun/all would be created from ${base}.`
      : `${plan.baseCommits} commit(s) of ${base} to merge into specrun/all first.`,
  );
  if (plan.conflicts.length > 0) {
    lines.push('Would refuse to start:', ...plan.conflicts.map((c) => `  - ${c}`));
  }
  return lines;
}
