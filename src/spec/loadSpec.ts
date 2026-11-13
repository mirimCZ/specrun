import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { Config } from '../config/configSchema.js';
import { formatIssues } from '../config/loadConfig.js';
import { SpecrunError } from '../errors.js';
import { SpecSchema, type Spec, type SpecTask } from './specSchema.js';

export const SPEC_FILE = 'tasks.yaml';
export const TASK_PROMPT_FILE = 'TASK_PROMPT.md';

export interface LoadedSpec {
  /** The folder name under `specsDir`. */
  name: string;
  dir: string;
  spec: Spec;
  briefPath: (id: string) => string;
  taskPromptPath: string | null;
}

export function specDir(repoRoot: string, config: Config, name: string): string {
  return join(repoRoot, config.specsDir, name);
}

function briefPathIn(dir: string, id: string): string {
  return join(dir, 'tasks', `${id}.md`);
}

export function readYamlFile(
  path: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: parse(readFileSync(path, 'utf8')) as unknown };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function loadSpec(repoRoot: string, config: Config, name: string): LoadedSpec {
  const dir = specDir(repoRoot, config, name);
  const path = join(dir, SPEC_FILE);
  if (!existsSync(path)) {
    throw new SpecrunError('spec-missing', `Spec "${name}" not found: ${path} does not exist`);
  }
  const yaml = readYamlFile(path);
  if (!yaml.ok) {
    throw new SpecrunError('spec-invalid', `${path} is not valid YAML`, [yaml.error]);
  }
  const parsed = SpecSchema.safeParse(yaml.value);
  if (!parsed.success) {
    throw new SpecrunError('spec-invalid', `${path} is invalid`, formatIssues(parsed.error));
  }
  const spec: Spec = { ...parsed.data, title: parsed.data.title ?? name };
  const problems = validateSpec(spec, (id) => existsSync(briefPathIn(dir, id)));
  if (problems.length > 0) {
    throw new SpecrunError('spec-invalid', `${path} is invalid`, problems);
  }
  const taskPromptPath = join(dir, TASK_PROMPT_FILE);
  return {
    name,
    dir,
    spec,
    briefPath: (id) => briefPathIn(dir, id),
    taskPromptPath: existsSync(taskPromptPath) ? taskPromptPath : null,
  };
}

/** Cross-task checks the schema can't express; returns every problem, one line each. */
function validateSpec(spec: Spec, briefExists: (id: string) => boolean): string[] {
  const problems: string[] = [];
  const byId = new Map<string, SpecTask>();
  for (const task of spec.tasks) {
    if (byId.has(task.id)) problems.push(`duplicate task id ${task.id}`);
    else byId.set(task.id, task);
  }
  for (const task of spec.tasks) {
    for (const need of task.needs) {
      const dependency = byId.get(need);
      if (need === task.id) problems.push(`${task.id} needs itself`);
      else if (dependency === undefined) problems.push(`${task.id} needs unknown task ${need}`);
      else if (dependency.phase > task.phase) {
        const phases = `phase ${task.phase} → ${dependency.phase}`;
        problems.push(`${task.id} needs ${need} of a later phase (${phases})`);
      }
    }
  }
  const cycle = findCycle(byId);
  if (cycle !== null) problems.push(`dependency cycle: ${cycle.join(' → ')}`);
  for (const id of byId.keys()) {
    if (!briefExists(id)) problems.push(`${id} has no brief: tasks/${id}.md is missing`);
  }
  return problems;
}

/** First cycle found by DFS as a closed path (`A-1 → A-2 → A-1`); self-needs are reported apart. */
function findCycle(byId: ReadonlyMap<string, SpecTask>): string[] | null {
  const done = new Set<string>();
  const stack: string[] = [];

  const visit = (id: string): string[] | null => {
    const onStack = stack.indexOf(id);
    if (onStack !== -1) return [...stack.slice(onStack), id];
    if (done.has(id)) return null;
    stack.push(id);
    for (const need of byId.get(id)?.needs ?? []) {
      if (need === id || !byId.has(need)) continue;
      const cycle = visit(need);
      if (cycle !== null) return cycle;
    }
    stack.pop();
    done.add(id);
    return null;
  };

  for (const id of byId.keys()) {
    const cycle = visit(id);
    if (cycle !== null) return cycle;
  }
  return null;
}

/** Spec names: folders under `specsDir` that contain a `tasks.yaml`, sorted. */
export function listSpecs(repoRoot: string, config: Config): string[] {
  const root = join(repoRoot, config.specsDir);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, SPEC_FILE)))
    .map((entry) => entry.name)
    .sort();
}
