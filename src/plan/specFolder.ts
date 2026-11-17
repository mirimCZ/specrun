import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { archiveRoot } from '../archive/history.js';
import type { Config } from '../config/configSchema.js';
import { SpecrunError } from '../errors.js';
import { specWorkspace } from '../git/workspace.js';
import { specDir } from '../spec/loadSpec.js';

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NUMBERED = /^(\d+)-/;

export interface PlanFolder {
  /** Folder name, `<NNN>-<name>`. */
  spec: string;
  dir: string;
  /** False when an active folder is continued; true when `createPlanFolder` must make it. */
  created: boolean;
}

/** Highest leading number of `names` + 1, zero-padded to 3 digits; `001` when none is numbered. */
export function nextSpecNumber(names: readonly string[]): string {
  let highest = 0;
  for (const name of names) {
    const match = NUMBERED.exec(name);
    if (match?.[1] !== undefined) highest = Math.max(highest, Number.parseInt(match[1], 10));
  }
  return String(highest + 1).padStart(3, '0');
}

function folderNames(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

/** Decides the folder of `specrun plan -n <name>` without creating it (PLD-1, PLD-2). */
export function resolvePlanFolder(repoRoot: string, config: Config, name: string): PlanFolder {
  if (!NAME_PATTERN.test(name)) {
    throw new SpecrunError('spec-invalid', `Invalid spec name "${name}"`, [
      'use lowercase letters, digits and single dashes, e.g. "plan-command"',
    ]);
  }
  if (NUMBERED.test(name)) {
    throw new SpecrunError('spec-invalid', `Spec name "${name}" starts with a number`, [
      'pass the name without the number — specrun numbers new specs itself',
    ]);
  }

  const root = join(repoRoot, config.specsDir);
  const suffix = `-${name}`;
  const matches = (folder: string): boolean =>
    NUMBERED.test(folder) && folder.slice(folder.indexOf('-')) === suffix;

  const archived = folderNames(archiveRoot(repoRoot, config)).find(matches);
  const active = folderNames(root).find(matches);
  if (active !== undefined) {
    if (specWorkspace(repoRoot, config, active).kind !== 'checkout') {
      throw new SpecrunError('spec-invalid', `Spec "${active}" has a worktree`, [
        'edit the spec in its worktree',
      ]);
    }
    return { spec: active, dir: specDir(repoRoot, config, active), created: false };
  }
  if (archived !== undefined) {
    throw new SpecrunError('spec-invalid', `Spec "${name}" is archived as ${archived}`, [
      'choose another name',
    ]);
  }

  const spec = `${nextSpecNumber([
    ...folderNames(root),
    ...folderNames(archiveRoot(repoRoot, config)),
  ])}${suffix}`;
  return { spec, dir: specDir(repoRoot, config, spec), created: true };
}

/** Separate from the resolution so `--print` creates nothing. */
export function createPlanFolder(folder: PlanFolder): void {
  mkdirSync(folder.dir, { recursive: true });
}
