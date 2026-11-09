import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Command } from 'commander';
import { latestMetrics } from '../../analytics/latestMetrics.js';
import type { SessionMetrics } from '../../analytics/metricsSchema.js';
import { recordAnalytics } from '../../analytics/recordAnalytics.js';
import { findRepoRoot, loadConfig } from '../../config/loadConfig.js';
import { SpecrunError } from '../../errors.js';
import { createEventStore } from '../../events/eventStore.js';
import { formatTokens } from '../../progress/renderProgress.js';
import { isProcessAlive, lockFile, readLockPid } from '../../runner/lock.js';
import { loadSpec } from '../../spec/loadSpec.js';
import { AnalyzeJsonSchema, type AnalyzeJson } from '../../stats/jsonOutput.js';
import { activeSpecFiles, type CliDeps } from '../cliDeps.js';
import { loadSpecInputs } from '../specInputs.js';

type AnalyzedTask = AnalyzeJson['specs'][number]['tasks'][number];

const PHASE_NAMES = ['orient', 'implement', 'test', 'fix'] as const;

/** Merges the latest metrics of all segments of one task into one summary. */
function summarize(task: string, segments: SessionMetrics[]): AnalyzedTask {
  const phases = {
    orient: { turns: 0, tokens: 0 },
    implement: { turns: 0, tokens: 0 },
    test: { turns: 0, tokens: 0 },
    fix: { turns: 0, tokens: 0 },
  };
  const files = new Map<string, number>();
  const readFirst = new Set<string>();
  const read = new Set<string>();
  let hasBrief = false;
  for (const m of segments) {
    for (const name of PHASE_NAMES) {
      phases[name].turns += m.phases[name].turns;
      phases[name].tokens += m.phases[name].tokens;
    }
    for (const f of m.files) files.set(f.path, (files.get(f.path) ?? 0) + f.resultChars);
    if (m.brief !== null) {
      hasBrief = true;
      m.brief.readFirst.forEach((p) => readFirst.add(p));
      m.brief.read.forEach((p) => read.add(p));
    }
  }
  return {
    task,
    segments: segments.length,
    peakContext: Math.max(0, ...segments.map((m) => m.peakContext)),
    topFiles: [...files]
      .map(([path, resultChars]) => ({ path, resultChars }))
      .sort((a, b) => b.resultChars - a.resultChars)
      .slice(0, 5),
    rereads: segments.reduce((sum, m) => sum + m.rereads, 0),
    unreadFirst: hasBrief ? [...readFirst].filter((p) => !read.has(p)) : null,
    phases,
    estimate: true,
  };
}

function render(output: AnalyzeJson): string {
  const blocks = output.specs.flatMap(({ spec, tasks }) =>
    tasks.map((t) => {
      const phases = PHASE_NAMES.map((n) => `${n} ${t.phases[n].turns}`).join(', ');
      const lines = [
        `${spec}/${t.task}  peak context ${formatTokens(t.peakContext)}, ${t.segments} segment(s), ${t.rereads} re-read(s)`,
        `  largest results: ${t.topFiles.map((f) => `${f.path} (${f.resultChars})`).join(', ') || '—'}`,
        `  unread Read-first files: ${t.unreadFirst === null ? 'n/a (no brief)' : t.unreadFirst.join(', ') || 'none'}`,
        `  turns by phase (estimate): ${phases}`,
      ];
      return lines.join('\n');
    }),
  );
  return blocks.length === 0 ? 'No analytics recorded yet.' : blocks.join('\n\n');
}

export function register(program: Command, deps: CliDeps): void {
  program
    .command('analyze')
    .description('Per-task session analytics; --reindex recomputes them from the transcripts')
    .argument('[spec]', 'spec folder name (default: all specs of this repo)')
    .option('--task <id>', 'only this task')
    .option('--reindex', 're-analyze every transcript and append new analytics events')
    .option('--json', 'machine-readable output')
    .action(
      (name: string | undefined, flags: { task?: string; reindex?: boolean; json?: boolean }) => {
        const repoRoot = findRepoRoot(deps.cwd);
        const config = loadConfig(repoRoot);
        const warnings: string[] = [];
        let reindexed: number | null = null;

        if (flags.reindex === true) {
          reindexed = 0;
          for (const input of loadSpecInputs(repoRoot, config, name === undefined ? [] : [name])) {
            const pid = readLockPid(lockFile(repoRoot, input.name));
            if (pid !== null && isProcessAlive(pid)) {
              throw new SpecrunError(
                'locked',
                `A run holds the lock of "${input.name}" (pid ${pid})`,
                ['stop it (Ctrl-C) before reindexing'],
              );
            }
            const files = activeSpecFiles(repoRoot, config, input.name);
            const loaded = loadSpec(files.base, config, input.name);
            const store = createEventStore({
              file: files.eventsFile,
              runId: `analyze-${randomUUID()}`,
              clock: { now: deps.now },
            });
            for (const s of input.state.sessions) {
              if (s.sessionId === null) continue;
              if (flags.task !== undefined && s.task !== flags.task) continue;
              const transcriptFile = join(
                config.transcriptsDir,
                basename(repoRoot),
                input.name,
                s.task,
                `${s.sessionId}-${s.segment}.jsonl.gz`,
              );
              if (!existsSync(transcriptFile)) {
                warnings.push(`${input.name}/${s.task}: transcript missing: ${transcriptFile}`);
                continue;
              }
              try {
                recordAnalytics({
                  store,
                  transcriptFile,
                  task: s.task,
                  sessionId: s.sessionId,
                  segment: s.segment,
                  reason: s.reason ?? 'start',
                  briefPath: loaded.briefPath(s.task),
                });
                reindexed += 1;
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                warnings.push(`${input.name}/${s.task}: ${message}`);
              }
            }
          }
        }

        // Read after reindexing so the output shows the fresh metrics.
        const specs = loadSpecInputs(repoRoot, config, name === undefined ? [] : [name]).map(
          ({ name: spec, spec: parsed, events }) => {
            const metrics = latestMetrics(events);
            const tasks = parsed.tasks
              .filter((t) => flags.task === undefined || t.id === flags.task)
              .flatMap((t) => {
                const segments = [...metrics]
                  .filter(([key]) => key.startsWith(`${t.id}/`))
                  .map(([, m]) => m);
                return segments.length === 0 ? [] : [summarize(t.id, segments)];
              });
            return { spec, tasks };
          },
        );
        const output = AnalyzeJsonSchema.parse({
          version: 1,
          generatedAt: deps.now().toISOString(),
          specs,
          reindexed,
          warnings,
        });

        if (flags.json === true) {
          deps.stdout(`${JSON.stringify(output, null, 2)}\n`);
          return;
        }
        for (const warning of warnings) deps.stderr(`warning: ${warning}\n`);
        if (reindexed !== null) deps.stdout(`Appended ${reindexed} analytics event(s).\n\n`);
        deps.stdout(`${render(output)}\n`);
      },
    );
}
