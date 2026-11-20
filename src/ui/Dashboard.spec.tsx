import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { Dashboard, formatElapsed } from './Dashboard.js';
import type { DashboardView } from './dashboardStore.js';

const NOW = new Date('2026-11-13T01:06:12Z');
const IDLE = { keys: true, stopRequested: false };

function view(over: Partial<DashboardView> = {}): DashboardView {
  return {
    title: 'Traits',
    phaseNumber: 1,
    done: 1,
    total: 3,
    activity: { label: 'TR-2 agent', since: new Date('2026-11-13T01:05:00Z') },
    running: { task: 'TR-2', since: new Date('2026-11-13T01:00:00Z') },
    rows: [
      {
        id: 'TR-1',
        title: 'Schema',
        status: 'done',
        model: 'opus',
        turns: 19,
        context: null,
        costUsd: 0.7,
        needs: [],
      },
      {
        id: 'TR-2',
        title: 'Picker',
        status: 'running',
        model: 'sonnet',
        turns: 31,
        context: 54_000,
        costUsd: 0.29,
        needs: [],
      },
      {
        id: 'TR-10',
        title: 'Docs',
        status: 'todo',
        model: null,
        turns: 0,
        context: null,
        costUsd: 0,
        needs: ['TR-2'],
      },
    ],
    tool: 'Edit src/traits/TraitPicker.tsx',
    usage: { sessionLeft: 41, sessionResetsAt: null, weeklyLeft: 63 },
    accounts: [],
    activeAccount: null,
    waiting: null,
    log: [
      {
        id: 0,
        at: new Date('2026-11-13T01:00:00Z'),
        segments: [{ text: '▶ TR-2 Picker (start, sonnet)' }],
      },
    ],
    ...over,
  };
}

describe('Dashboard', () => {
  it('shows every account with the active one marked', () => {
    const usage = { sessionLeft: 41, sessionResetsAt: null, weeklyLeft: 63 };
    const { lastFrame } = render(
      <Dashboard
        view={view({
          accounts: [
            { name: 'default', usage },
            { name: 'ipsum', usage: { ...usage, sessionLeft: 7 } },
          ],
          activeAccount: 'ipsum',
        })}
        control={IDLE}
        now={NOW}
        frame={0}
        width={100}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('default session 41 % left');
    expect(frame).toContain('▸ ipsum session 7 % left');
  });

  it('shows the log, the header with the task clock, task rows, the tool and usage', () => {
    const { lastFrame } = render(
      <Dashboard view={view()} control={IDLE} now={NOW} frame={2} width={80} />,
    );
    const frame = lastFrame() ?? '';

    expect(frame).toContain('▶ TR-2 Picker (start, sonnet)');
    expect(frame).toContain('Traits · phase 1 · 1/3 done · ⠹ TR-2 agent · 6m 12s');
    expect(frame).toMatch(/✔ TR-1 +Schema +opus {2}19 t {2}\$0\.70/);
    expect(frame).toMatch(/▶ TR-2 +Picker +sonnet {2}31 t {2}ctx 54k {2}\$0\.29/);
    expect(frame).toContain('🔧 Edit src/traits/TraitPicker.tsx');
    expect(frame).toMatch(/· TR-10 Docs +needs TR-2/);
    expect(frame).toContain('session 41 % left · weekly 63 % left');
  });

  it('shows the startup phase alone before the spec is loaded', () => {
    const { lastFrame } = render(
      <Dashboard
        view={view({
          title: null,
          phaseNumber: null,
          done: 0,
          total: 0,
          rows: [],
          running: null,
          tool: null,
          usage: null,
          activity: { label: 'setup: npm ci', since: new Date('2026-11-13T01:05:30Z') },
          log: [],
        })}
        control={IDLE}
        now={NOW}
        frame={0}
        width={80}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('specrun · ⠋ setup: npm ci · 42s');
    expect(frame).toContain('usage unknown');
  });

  it('counts down while waiting and keeps the file name of long tool paths', () => {
    const { lastFrame } = render(
      <Dashboard
        view={view({
          waiting: { until: new Date('2026-11-13T02:18:12Z'), reason: 'session-low' },
          tool: 'Read apps/fate-binder/app/bestiary/components/very/deep/folder/MonsterCard.tsx',
        })}
        control={IDLE}
        now={NOW}
        frame={0}
        width={70}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/⏳ waiting until \d\d:\d\d \(session-low\) · 1h 12m left/);
    expect(frame).toContain('MonsterCard.tsx');
    expect(frame).not.toContain('apps/fate-binder');
  });
});

describe('Dashboard controls', () => {
  const frameOf = (over: Partial<DashboardView>, control: typeof IDLE): string =>
    render(
      <Dashboard view={view(over)} control={control} now={NOW} frame={0} width={100} />,
    ).lastFrame() ?? '';

  it('hints the keys while running and drops the hint once the run finished', () => {
    expect(frameOf({}, IDLE)).toContain(
      's / Ctrl+C stop after this task · Ctrl+C twice interrupt now',
    );
    expect(frameOf({}, { keys: false, stopRequested: false })).toContain(
      'Ctrl+C stop after this task · twice interrupt now',
    );
    expect(frameOf({ activity: null, running: null }, IDLE)).not.toContain('stop after');
  });

  it('shows that a stop is pending until the running task finished', () => {
    expect(frameOf({}, { keys: true, stopRequested: true })).toContain(
      '⏹ stopping after TR-2 finishes · c cancel · Ctrl+C interrupt now',
    );
    expect(frameOf({ running: null }, { keys: false, stopRequested: true })).toContain(
      '⏹ stopping before the next task · Ctrl+C interrupt now',
    );
  });
});

describe('formatElapsed', () => {
  it('drops seconds after an hour', () => {
    expect([0, 42_000, 372_000, 3_725_000, -5].map(formatElapsed)).toEqual([
      '0s',
      '42s',
      '6m 12s',
      '1h 02m',
      '0s',
    ]);
  });
});
