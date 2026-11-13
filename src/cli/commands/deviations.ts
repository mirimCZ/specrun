import type { Command } from 'commander';
import { findRepoRoot, loadConfig } from '../../config/loadConfig.js';
import { DEVIATION_KINDS } from '../../events/eventSchema.js';
import { DeviationsJsonSchema } from '../../stats/jsonOutput.js';
import type { CliDeps } from '../cliDeps.js';
import { formatListing, selectDeviations } from '../deviationListing.js';

export function register(program: Command, deps: CliDeps): void {
  program
    .command('deviations')
    .description('Deviations agents reported, grouped by kind (specrun review walks through them)')
    .argument('[spec...]', 'spec folder names (default: all specs of this repo)')
    .option('--kind <kind>', `only one kind: ${DEVIATION_KINDS.join(' | ')}`)
    .option('--json', 'machine-readable output')
    .action((names: string[], flags: { kind?: string; json?: boolean }) => {
      const repoRoot = findRepoRoot(deps.cwd);
      const config = loadConfig(repoRoot);
      const { entries, counts } = selectDeviations(repoRoot, config, names, flags.kind);
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
      deps.stdout(
        entries.length === 0 ? 'No deviations reported.\n' : formatListing(entries, counts),
      );
    });
}
