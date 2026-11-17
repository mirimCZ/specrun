import { existsSync, readdirSync } from 'node:fs';
import type { Command } from 'commander';
import { archiveRoot } from '../../archive/history.js';
import { findRepoRoot, loadConfig } from '../../config/loadConfig.js';
import { checkFeatureMap, type SpecTaskFeatures } from '../../features/checkFeatureMap.js';
import { loadFeatureMap } from '../../features/loadFeatureMap.js';
import { listSpecs, loadSpec } from '../../spec/loadSpec.js';
import { activeSpecFiles, type CliDeps } from '../cliDeps.js';

export function register(program: Command, deps: CliDeps): void {
  const features = program.command('features').description('Work with the feature map');
  features
    .command('check')
    .description('Validate the feature map and the feature ids in tasks.yaml')
    .action(() => {
      const repoRoot = findRepoRoot(deps.cwd);
      const config = loadConfig(repoRoot);
      const map = loadFeatureMap(repoRoot, config);
      if (map === null) {
        deps.stdout(`No feature map (${config.featuresDir}/ does not exist)\n`);
        return;
      }
      const active = listSpecs(repoRoot, config);
      const specTaskFeatures: SpecTaskFeatures[] = [];
      for (const name of active) {
        // A spec that fails to load is `specrun status`' business, not the map's.
        try {
          const { base } = activeSpecFiles(repoRoot, config, name);
          const { spec } = loadSpec(base, config, name);
          for (const task of spec.tasks) {
            specTaskFeatures.push({ spec: name, task: task.id, features: task.features ?? [] });
          }
        } catch {
          continue;
        }
      }
      const archived = archiveRoot(repoRoot, config);
      const archivedNames = existsSync(archived)
        ? readdirSync(archived, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
        : [];
      const problems = checkFeatureMap(map, {
        repoRoot,
        config,
        specTaskFeatures,
        knownSpecs: [...active, ...archivedNames],
      });
      const errors = problems.filter((p) => p.level === 'error');
      const warnings = problems.filter((p) => p.level === 'warning');
      for (const p of [...errors, ...warnings]) {
        deps.stdout(`${p.level === 'warning' ? 'warning: ' : ''}${p.path}: ${p.message}\n`);
      }
      if (errors.length === 0 && warnings.length === 0) {
        deps.stdout(`feature map OK — ${String(map.docs.length)} features\n`);
      } else {
        deps.stdout(`${String(errors.length)} errors, ${String(warnings.length)} warnings\n`);
      }
      if (errors.length > 0) process.exitCode = 1;
    });
}
