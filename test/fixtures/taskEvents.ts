import { eventLine } from './specRepo.js';

/** Events of a task that ran one segment and was committed; `extra` goes before the commit. */
export function doneTask(task: string, turns: number, costUsd: number, extra = ''): string {
  return (
    eventLine({
      t: 'session.started',
      task,
      sessionId: null,
      segment: 0,
      attempt: 1,
      model: 'sonnet',
      reason: 'start',
      prompt: { protocol: 1, spec: 1, brief: 1, deps: 0 },
    }) +
    eventLine({
      t: 'session.finished',
      task,
      sessionId: `s-${task}`,
      segment: 0,
      outcome: 'completed',
      turns,
      peakContext: 80_000,
      inputTokens: 1,
      outputTokens: 1,
      cacheRead: 1,
      cacheWrite: 1,
      costUsd,
      durationMs: 1000,
    }) +
    extra +
    eventLine({
      t: 'task.committed',
      task,
      commit: 'abcdef1234',
      filesChanged: 1,
      insertions: 1,
      deletions: 0,
    })
  );
}
