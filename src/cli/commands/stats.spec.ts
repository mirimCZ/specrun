import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  captureDeps,
  eventLine,
  makeTempRepo,
  writeDemoSpec,
} from '../../../test/fixtures/specRepo.js';
import { SHELVED, writeArchivedHistory } from '../../../test/fixtures/archive.js';
import { doneTask } from '../../../test/fixtures/taskEvents.js';
import { StatsJsonSchema } from '../../stats/jsonOutput.js';
import { createProgram } from '../program.js';

let dir: string;
beforeEach(() => {
  dir = makeTempRepo();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function stats(...args: string[]): Promise<string> {
  const deps = captureDeps(dir);
  await createProgram(deps).parseAsync(['node', 'specrun', 'stats', ...args]);
  return deps.out.join('');
}

describe('specrun stats', () => {
  it('includes archived specs: all by default, by name when named', async () => {
    const specDir = writeDemoSpec(dir);
    writeFileSync(join(specDir, 'events.jsonl'), doneTask('D-1', 12, 0.4));
    writeArchivedHistory(dir, 'old');

    const all = StatsJsonSchema.parse(JSON.parse(await stats('--json')));
    expect(all.specs).toEqual(['demo', 'old']);
    expect(all.samples.map((s) => s.task)).toEqual(['D-1', 'OLD-1']);

    const old = StatsJsonSchema.parse(JSON.parse(await stats('old', '--json')));
    expect(old.samples.map((s) => s.task)).toEqual(['OLD-1']);
    const demo = StatsJsonSchema.parse(JSON.parse(await stats('demo', '--json')));
    expect(demo.specs).toEqual(['demo']);
  });

  it('marks shelved specs, whose samples still count', async () => {
    const specDir = writeDemoSpec(dir);
    writeFileSync(join(specDir, 'events.jsonl'), doneTask('D-1', 12, 0.4));
    writeArchivedHistory(dir, 'old', [], SHELVED);

    const json = StatsJsonSchema.parse(JSON.parse(await stats('--json')));
    expect(json.shelved).toEqual(['old']);
    expect(json.samples.map((s) => s.task)).toEqual(['D-1', 'OLD-1']);
    expect(await stats('--by', 'spec')).toMatch(/old \(shelved\)\s+1\s+50/);
    expect(await stats()).toContain('Includes shelved specs (not merged): old\n');
  });

  it('times the verify rounds and steps of each spec', async () => {
    const specDir = writeDemoSpec(dir);
    const round = (durationMs: number) =>
      eventLine({
        t: 'verify.finished',
        task: 'D-1',
        round: 0,
        ok: true,
        durationMs,
        steps: [{ name: 'lorem', ok: true, durationMs }],
        log: 'verify.log',
      });
    // Session 1000 ms, verify 3000 ms: verify takes 75 % of the task time.
    writeFileSync(
      join(specDir, 'events.jsonl'),
      doneTask('D-1', 12, 0.4, round(1000) + round(2000)),
    );

    const json = StatsJsonSchema.parse(JSON.parse(await stats('--json')));
    expect(json.verify).toEqual([
      expect.objectContaining({ spec: 'demo', runs: 2, sumMs: 3000, sessionMs: 1000 }),
    ]);
    const out = await stats();
    expect(out).toMatch(/demo\s+round\s+2\s+0\s+1s\s+2s\s+2s\s+3s\s+75%/);
    expect(out).toMatch(/\s+lorem\s+2\s+0\s+1s/);
  });

  it('prints a table grouped by the chosen dimension', async () => {
    const specDir = writeDemoSpec(dir);
    writeFileSync(
      join(specDir, 'events.jsonl'),
      doneTask('D-1', 12, 0.4) +
        doneTask('D-2', 30, 1.1) +
        eventLine({
          t: 'budget.exceeded',
          task: 'D-2',
          size: 'M',
          turns: 30,
          costUsd: 1.1,
          limit: { turns: 20, usd: 1 },
        }),
    );
    const bySize = await stats('--by', 'size');
    expect(bySize).toMatch(/S\s+1\s+12/);
    expect(bySize).toMatch(/M\s+1\s+30.*1 over budget/);
    expect(await stats('--by', 'task')).toContain('demo/D-1');
  });

  it('reports not enough data when calibrating with few samples', async () => {
    const specDir = writeDemoSpec(dir);
    writeFileSync(join(specDir, 'events.jsonl'), doneTask('D-1', 12, 0.4));
    expect(await stats('--calibrate')).toContain('not enough data (1)');
  });

  it('validates its --json output against the schema', async () => {
    const specDir = writeDemoSpec(dir);
    writeFileSync(join(specDir, 'events.jsonl'), doneTask('D-1', 12, 0.4));
    const json = StatsJsonSchema.parse(JSON.parse(await stats('--json', '--calibrate')));
    expect(json.samples).toHaveLength(1);
    expect(json.calibration?.[0]).toMatchObject({ size: 'S', n: 1, suggestion: null });
    expect(StatsJsonSchema.parse(JSON.parse(await stats('demo', '--json'))).calibration).toBeNull();
  });

  it('prints the Planning table only when there is planning data', async () => {
    const specDir = writeDemoSpec(dir);
    writeFileSync(join(specDir, 'events.jsonl'), doneTask('D-1', 12, 0.4));
    expect(await stats()).not.toContain('Planning');
    expect(StatsJsonSchema.parse(JSON.parse(await stats('--json'))).planning).toEqual([]);

    writeFileSync(
      join(specDir, 'events.jsonl'),
      doneTask('D-1', 12, 0.4) +
        eventLine({
          t: 'plan.session',
          sessionId: 's1',
          resumed: false,
          exitCode: 0,
          metrics: {
            turns: 4,
            inputTokens: 100,
            outputTokens: 50,
            cacheRead: 2000,
            cacheWrite: 10,
            peakContext: 8000,
            models: ['m'],
            subagents: {
              files: 0,
              turns: 0,
              inputTokens: 0,
              outputTokens: 0,
              cacheRead: 0,
              cacheWrite: 0,
            },
          },
        }),
    );
    const text = await stats();
    expect(text).toContain('CACHE READ');
    expect(text).toContain('PEAK CTX');
    const json = StatsJsonSchema.parse(JSON.parse(await stats('--json')));
    expect(json.planning).toEqual([
      expect.objectContaining({ spec: 'demo', sessions: 1, turns: 4, peakContext: 8000 }),
    ]);
  });

  it('says so when nothing is finished and rejects an unknown dimension', async () => {
    const specDir = writeDemoSpec(dir);
    writeFileSync(join(specDir, 'events.jsonl'), '');
    expect(await stats()).toContain('No finished tasks');
    await expect(stats('--by', 'color')).rejects.toThrow('Invalid --by');
  });
});
