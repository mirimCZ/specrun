import { isShelved, readArchivedHistories, type History } from '../archive/history.js';
import type { Config } from '../config/configSchema.js';
import { SpecrunError } from '../errors.js';
import { readEvents } from '../events/eventStore.js';
import { deriveState } from '../events/taskState.js';
import { listSpecs, loadSpec } from '../spec/loadSpec.js';
import type { SpecInput } from '../stats/aggregate.js';
import { activeSpecFiles } from './cliDeps.js';

export interface RunHistory {
  inputs: SpecInput[];
  /** Archived specs (`specrun archive`): only what their `history.json` kept. */
  archived: History[];
}

/** Names of the archived specs that were shelved, not merged (SRD-35). */
export function shelvedSpecs(history: RunHistory): string[] {
  return history.archived.filter(isShelved).map((h) => h.spec);
}

/** Like `loadSpecInputs`, plus archived specs: all of them, or the named ones. */
export function loadRunHistory(
  repoRoot: string,
  config: Config,
  names: readonly string[],
): RunHistory {
  const archived = readArchivedHistories(repoRoot, config);
  if (names.length === 0) return { inputs: loadSpecInputs(repoRoot, config, []), archived };
  const known = new Set(listSpecs(repoRoot, config));
  const archivedNames = new Set(archived.map((h) => h.spec));
  // A name only in the archive must not reach loadSpecInputs, which rejects it.
  const live = names.filter((name) => known.has(name) || !archivedNames.has(name));
  return {
    inputs: live.length === 0 ? [] : loadSpecInputs(repoRoot, config, live),
    archived: archived.filter((h) => names.includes(h.spec)),
  };
}

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
