import type { Command } from 'commander';
import { findRepoRoot, loadConfig } from '../../config/loadConfig.js';
import { SpecrunError } from '../../errors.js';
import { DEVIATION_KINDS, type Deviation } from '../../events/eventSchema.js';
import { formatQuestion } from '../../events/formatQuestion.js';
import { DeviationsJsonSchema, type DeviationsJson } from '../../stats/jsonOutput.js';
import type { CliDeps } from '../cliDeps.js';
import { loadSpecInputs } from '../specInputs.js';

type Entry = DeviationsJson['deviations'][number];

function isKind(value: string): value is Entry['kind'] {
  return (DEVIATION_KINDS as readonly string[]).includes(value);
}

function inline(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ').trim();
}

export function register(program: Command, deps: CliDeps): void {
  program
    .command('deviations')
    .description('Deviations agents reported, grouped by kind')
    .argument('[spec...]', 'spec folder names (default: all specs of this repo)')
    .option('--kind <kind>', `only one kind: ${DEVIATION_KINDS.join(' | ')}`)
    .option('--json', 'machine-readable output')
    .action((names: string[], flags: { kind?: string; json?: boolean }) => {
      if (flags.kind !== undefined && !isKind(flags.kind)) {
        throw new SpecrunError('spec-invalid', `Invalid --kind "${flags.kind}"`, [
          `expected one of: ${DEVIATION_KINDS.join(', ')}`,
        ]);
      }
      const repoRoot = findRepoRoot(deps.cwd);
      const config = loadConfig(repoRoot);
      const inputs = loadSpecInputs(repoRoot, config, names);

      const entries: Entry[] = [];
      for (const { name, spec, events, state } of inputs) {
        for (const task of spec.tasks) {
          const s = state.tasks.get(task.id);
          // Done tasks keep their payload in state; for blocked ones it is the latest task.completed.
          let deviations: Deviation[] = [];
          if (s?.status === 'done') {
            deviations = s.lastCompleted?.deviations ?? [];
          } else if (s?.status === 'blocked') {
            for (const e of events) {
              if (e.t === 'task.completed' && e.task === task.id) deviations = e.payload.deviations;
            }
          }
          for (const d of deviations) {
            if (flags.kind !== undefined && d.kind !== flags.kind) continue;
            entries.push({
              spec: name,
              task: task.id,
              kind: d.kind,
              decision: d.decision ?? null,
              what: d.what,
              why: d.why,
              question: d.question ?? null,
            });
          }
        }
      }

      const counts: Record<string, number> = {};
      for (const e of entries) counts[e.kind] = (counts[e.kind] ?? 0) + 1;

      if (flags.json === true) {
        const output = DeviationsJsonSchema.parse({
          version: 1,
          generatedAt: deps.now().toISOString(),
          deviations: entries,
          counts,
        });
        deps.stdout(`${JSON.stringify(output, null, 2)}\n`);
        return;
      }
      if (entries.length === 0) {
        deps.stdout('No deviations reported.\n');
        return;
      }
      const sections = DEVIATION_KINDS.filter((kind) => (counts[kind] ?? 0) > 0).map((kind) => {
        const lines = entries
          .filter((e) => e.kind === kind)
          .map((e) => {
            const decision = e.decision === null ? '' : `${inline(e.decision)}: `;
            const line = `  ${e.spec}/${e.task} [${e.kind}] ${decision}${inline(e.what)} — ${inline(e.why)}`;
            return e.question === null ? line : `${line}\n    ${formatQuestion(e.question)}`;
          });
        return `${kind} (${counts[kind]})\n${lines.join('\n')}`;
      });
      deps.stdout(`${sections.join('\n\n')}\n`);
    });
}
