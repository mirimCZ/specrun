import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from '../config/configSchema.js';
import type { SpecrunEvent } from '../events/eventSchema.js';
import { EVENTS_FILE, readEvents } from '../events/eventStore.js';
import { SPEC_FILE, specDir } from '../spec/loadSpec.js';
import { worktreePath } from './worktree.js';

/** `run --all` (SRD-31): one worktree, lock and branch for every spec it runs. */
export const SHARED_ID = '.all';
export const SHARED_BRANCH = 'specrun/all';

export function sharedWorktreePath(repoRoot: string): string {
  return worktreePath(repoRoot, SHARED_ID);
}

/** Where a spec's live copy is: its own worktree, the shared one, or the main checkout. */
export type SpecWorkspace =
  | { kind: 'own'; path: string }
  | { kind: 'shared'; path: string }
  | { kind: 'checkout'; path: string };

/** Branch of the spec's latest run; null before its first run. */
export function lastRunBranch(events: readonly SpecrunEvent[]): string | null {
  const started = events.findLast((event) => event.t === 'run.started');
  return started?.t === 'run.started' ? started.branch : null;
}

/** Whether the spec's log says it last ran on the shared branch. */
export function ranShared(root: string, config: Config, spec: string): boolean {
  const file = join(specDir(root, config, spec), EVENTS_FILE);
  return lastRunBranch(readEvents(file).events) === SHARED_BRANCH;
}

/**
 * The shared worktree holds a copy of every spec, but only those that ran there live in it —
 * the others' copies are as stale as the main checkout's.
 */
export function specWorkspace(repoRoot: string, config: Config, spec: string): SpecWorkspace {
  const own = worktreePath(repoRoot, spec);
  if (existsSync(own)) return { kind: 'own', path: own };
  const shared = sharedWorktreePath(repoRoot);
  if (
    existsSync(join(specDir(shared, config, spec), SPEC_FILE)) &&
    ranShared(shared, config, spec)
  ) {
    return { kind: 'shared', path: shared };
  }
  return { kind: 'checkout', path: repoRoot };
}

/**
 * Whether `specrun run <spec>` belongs in the shared workspace: with worktrees, a spec living in
 * the shared one; in place (`"worktree": false`), one whose checked-out log last ran there.
 */
export function runsShared(repoRoot: string, config: Config, spec: string): boolean {
  return config.worktree
    ? specWorkspace(repoRoot, config, spec).kind === 'shared'
    : ranShared(repoRoot, config, spec);
}
