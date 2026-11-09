import { describe, expect, it } from 'vitest';
import type { SpecrunEvent } from '../events/eventSchema.js';
import { createFakeClock } from '../../test/fakes/fakeClock.js';
import { createLineReporter } from './lineReporter.js';

function setup(): {
  lines: string[];
  reporter: ReturnType<typeof createLineReporter>;
  advance: (ms: number) => void;
} {
  const lines: string[] = [];
  const clock = createFakeClock(new Date('2026-01-01T10:00:00.000Z'));
  const reporter = createLineReporter((text) => lines.push(text), {
    color: false,
    now: () => clock.now(),
  });
  return { lines, reporter, advance: (ms) => clock.advance(ms) };
}

const base = { v: 1, at: '2026-01-01T10:00:00.000Z', runId: 'r' } as const;
const asEvent = (event: object): SpecrunEvent => ({ ...base, ...event }) as SpecrunEvent;

describe('createLineReporter', () => {
  it('prints task finish with the summed session stats', () => {
    const { lines, reporter } = setup();
    for (const [turns, peak, cost] of [
      [30, 58_000, 0.3],
      [12, 40_000, 0.2],
    ] as const) {
      reporter.event(
        asEvent({
          t: 'session.finished',
          task: 'SR-1',
          sessionId: 's',
          segment: 0,
          outcome: 'completed',
          turns,
          peakContext: peak,
          inputTokens: 0,
          outputTokens: 0,
          cacheRead: 0,
          cacheWrite: 0,
          costUsd: cost,
          durationMs: 1,
        }),
      );
    }
    reporter.event(
      asEvent({
        t: 'task.committed',
        task: 'SR-1',
        commit: 'abcdef123456',
        filesChanged: 1,
        insertions: 1,
        deletions: 0,
      }),
    );
    expect(lines.at(-1)).toContain('✔ SR-1 committed abcdef1 · 42 turns · peak 58k · $0.50');
  });

  it('prints verify results, blocks, waits and tool uses', () => {
    const { lines, reporter } = setup();
    reporter.event(
      asEvent({
        t: 'verify.finished',
        task: 'SR-1',
        round: 1,
        ok: false,
        durationMs: 1,
        steps: [{ name: 'test', ok: false, durationMs: 1 }],
        log: 'x',
      }),
    );
    reporter.event(asEvent({ t: 'task.blocked', task: 'SR-1', reason: 'no way', source: 'agent' }));
    reporter.event(
      asEvent({ t: 'limit.wait', reason: 'limit-hit', until: '2026-01-01T12:30:00.000Z' }),
    );
    reporter.activity({ task: 'SR-1', tool: 'Edit', detail: 'src/x.ts' });
    const text = lines.join('');
    expect(text).toContain('verify SR-1 round 1: failed (test)');
    expect(text).toContain('✖ SR-1 blocked (agent): no way');
    expect(text).toContain('waiting until');
    expect(text).toContain('🔧 Edit src/x.ts');
  });

  it('ignores events without a line and throttles waiting to every 10 minutes', () => {
    const { lines, reporter, advance } = setup();
    reporter.event(
      asEvent({
        t: 'usage.snapshot',
        sessionLeft: 1,
        sessionResetsAt: null,
        weeklyLeft: null,
        weeklyResetsAt: null,
        source: 'probe',
      }),
    );
    expect(lines).toEqual([]);
    const until = new Date('2026-01-01T14:00:00.000Z');
    for (let tick = 0; tick < 25; tick += 1) {
      reporter.waiting({ until, reason: 'session-low' });
      advance(60_000);
    }
    expect(lines).toHaveLength(3);
  });
});
