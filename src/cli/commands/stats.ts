import type { Command } from 'commander';
import { findRepoRoot, loadConfig } from '../../config/loadConfig.js';
import { SpecrunError } from '../../errors.js';
import { formatTokens, formatUsd } from '../../progress/renderProgress.js';
import {
  calibrate,
  groupStats,
  planningSummary,
  taskSamples,
  type CalibrationRow,
  type GroupDimension,
} from '../../stats/aggregate.js';
import { StatsJsonSchema, type StatsJson } from '../../stats/jsonOutput.js';
import type { CliDeps } from '../cliDeps.js';
import { loadRunHistory, shelvedSpecs } from '../specInputs.js';
import { table } from '../table.js';

const DIMENSIONS: readonly GroupDimension[] = ['task', 'model', 'size', 'spec'];

function isDimension(value: string): value is GroupDimension {
  return (DIMENSIONS as readonly string[]).includes(value);
}

function calibrationTable(rows: CalibrationRow[]): string {
  if (rows.length === 0) return 'No finished tasks to calibrate from.';
  const cells = rows.map((row) => [
    row.model,
    row.size,
    row.current === null
      ? '—'
      : `${row.current.turns[0]}–${row.current.turns[1]} / ${formatUsd(row.current.usd)}`,
    row.suggestion === null
      ? `not enough data (${row.n})`
      : `${row.suggestion.turns[0]}–${row.suggestion.turns[1]} / ${formatUsd(row.suggestion.usd)}`,
    String(row.n),
  ]);
  return table([
    ['MODEL', 'SIZE', 'CURRENT (turns / usd)', 'SUGGESTED (p10–p90 / p90)', 'N'],
    ...cells,
  ]);
}

function planningTable(rows: StatsJson['planning']): string {
  return table([
    ['SPEC', 'SESSIONS', 'TURNS', 'IN', 'OUT', 'CACHE READ', 'PEAK CTX'],
    ...rows.map((r) => [
      r.spec,
      String(r.sessions),
      String(r.turns),
      formatTokens(r.inputTokens),
      formatTokens(r.outputTokens),
      formatTokens(r.cacheRead),
      formatTokens(r.peakContext),
    ]),
  ]);
}

export function register(program: Command, deps: CliDeps): void {
  program
    .command('stats')
    .description('Turns, cost and context of finished tasks, grouped; --calibrate suggests sizes')
    .argument('[spec...]', 'spec folder names (default: all specs of this repo)')
    .option('--all', 'all specs of this repo (the default when none is named)')
    .option('--by <dim>', `group by ${DIMENSIONS.join(' | ')}`, 'model')
    .option('--calibrate', 'suggest turn and cost ranges per model × size')
    .option('--json', 'machine-readable output')
    .action(
      (
        names: string[],
        flags: { all?: boolean; by: string; calibrate?: boolean; json?: boolean },
      ) => {
        if (!isDimension(flags.by)) {
          throw new SpecrunError('spec-invalid', `Invalid --by "${flags.by}"`, [
            `expected one of: ${DIMENSIONS.join(', ')}`,
          ]);
        }
        const repoRoot = findRepoRoot(deps.cwd);
        const config = loadConfig(repoRoot);
        const { inputs, archived } = loadRunHistory(
          repoRoot,
          config,
          flags.all === true ? [] : names,
        );
        const samples = [...taskSamples(inputs), ...archived.flatMap((h) => h.samples)];
        const planning = [
          ...inputs.flatMap((i) => {
            const summary = planningSummary(i.events);
            return summary === null ? [] : [{ spec: i.name, ...summary }];
          }),
          ...archived.flatMap((h) =>
            h.planning === null ? [] : [{ spec: h.spec, ...h.planning }],
          ),
        ];
        const shelved = shelvedSpecs({ inputs, archived });
        const groups = groupStats(samples, flags.by);
        const calibration = flags.calibrate === true ? calibrate(samples, config.sizes) : null;

        if (flags.json === true) {
          const output: StatsJson = StatsJsonSchema.parse({
            version: 1,
            generatedAt: deps.now().toISOString(),
            specs: [...inputs.map((i) => i.name), ...archived.map((h) => h.spec)],
            shelved,
            by: flags.by,
            samples,
            groups,
            calibration,
            planning,
          });
          deps.stdout(`${JSON.stringify(output, null, 2)}\n`);
          return;
        }
        if (samples.length === 0) {
          deps.stdout('No finished tasks yet.\n');
          if (planning.length > 0) deps.stdout(`\n${planningTable(planning)}\n`);
          return;
        }
        const rows = groups.map((g) => [
          flags.by === 'spec' && shelved.includes(g.key) ? `${g.key} (shelved)` : g.key,
          String(g.count),
          String(g.turns.sum),
          String(g.turns.p50),
          String(g.turns.p90),
          formatUsd(g.costUsd.sum),
          formatUsd(g.costUsd.p50),
          formatUsd(g.costUsd.p90),
          formatTokens(g.peakContext.p50),
          formatTokens(g.peakContext.p90),
          g.budgetExceeded > 0 ? `${g.budgetExceeded} over budget` : '',
        ]);
        deps.stdout(
          `${table([
            [
              flags.by.toUpperCase(),
              'N',
              'TURNS',
              'P50',
              'P90',
              'COST',
              'P50',
              'P90',
              'CTX P50',
              'CTX P90',
              '',
            ],
            ...rows,
          ])}\n`,
        );
        const counted = shelved.filter((spec) => samples.some((s) => s.spec === spec));
        if (counted.length > 0 && flags.by !== 'spec') {
          deps.stdout(`Includes shelved specs (not merged): ${counted.join(', ')}\n`);
        }
        if (calibration !== null) deps.stdout(`\n${calibrationTable(calibration)}\n`);
        if (planning.length > 0) deps.stdout(`\n${planningTable(planning)}\n`);
      },
    );
}
