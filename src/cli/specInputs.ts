import type { Config } from '../config/configSchema.js';
import { SpecrunError } from '../errors.js';
import { readEvents } from '../events/eventStore.js';
import { deriveState } from '../events/taskState.js';
import { listSpecs, loadSpec } from '../spec/loadSpec.js';
import type { SpecInput } from '../stats/aggregate.js';
import { activeSpecFiles } from './cliDeps.js';

/** Named specs, or all specs of the repo when none are named; events come from the worktree first. */
export function loadSpecInputs(
  repoRoot: string,
  config: Config,
  names: readonly string[],
): SpecInput[] {
  const known = listSpecs(repoRoot, config);
  const selected = names.length > 0 ? names : known;
  return selected.map((name) => {
    const files = activeSpecFiles(repoRoot, config, name);
    if (!known.includes(name) && files.worktree === null) {
      throw new SpecrunError('spec-missing', `Spec "${name}" not found`);
    }
    const { spec } = loadSpec(files.base, config, name);
    const events = readEvents(files.eventsFile).events;
    return { name, spec, state: deriveState(spec, events), events };
  });
}
