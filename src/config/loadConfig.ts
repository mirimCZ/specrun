import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { z } from 'zod';
import { SpecrunError } from '../errors.js';
import { ConfigSchema, type Config } from './configSchema.js';

export const CONFIG_FILE = 'specrun.config.json';

export interface LoadConfigDeps {
  homedir: () => string;
}

/** Walks up from `cwd` to the directory holding `.git` (a folder, or a file in worktrees). */
export function findRepoRoot(cwd: string): string {
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new SpecrunError('repo-missing', `Not inside a git repository: ${cwd}`);
    }
    dir = parent;
  }
}

/** One `path: message` line per issue; used for every authored file specrun validates. */
export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map(String).join('.');
    return `${path === '' ? '(root)' : path}: ${issue.message}`;
  });
}

export function readJsonFile(
  path: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, 'utf8')) as unknown };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function loadConfig(repoRoot: string, deps: LoadConfigDeps = { homedir }): Config {
  const path = join(repoRoot, CONFIG_FILE);
  if (!existsSync(path)) {
    throw new SpecrunError('config-missing', `${CONFIG_FILE} not found in ${repoRoot}`, [
      'run specrun init to create it',
    ]);
  }
  const json = readJsonFile(path);
  if (!json.ok) {
    throw new SpecrunError('config-invalid', `${CONFIG_FILE} is not valid JSON`, [json.error]);
  }
  const parsed = ConfigSchema.safeParse(json.value);
  if (!parsed.success) {
    throw new SpecrunError(
      'config-invalid',
      `${CONFIG_FILE} is invalid`,
      formatIssues(parsed.error),
    );
  }
  const config = parsed.data;
  if (config.transcriptsDir.startsWith('~/')) {
    config.transcriptsDir = join(deps.homedir(), config.transcriptsDir.slice(2));
  }
  return config;
}
