import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureDeps, makeTempRepo, writeDemoSpec } from '../../../test/fixtures/specRepo.js';
import { doneTask } from '../../../test/fixtures/taskEvents.js';
import { createProgram } from '../program.js';

let dir: string;
beforeEach(() => {
  dir = makeTempRepo();
  rmSync(join(dir, '.git'), { recursive: true });
  // The command runs the real git without injectable env; the identity must not come from the
  // user's config.
  vi.stubEnv('GIT_AUTHOR_NAME', 'Test');
  vi.stubEnv('GIT_AUTHOR_EMAIL', 'test@example.com');
  vi.stubEnv('GIT_COMMITTER_NAME', 'Test');
  vi.stubEnv('GIT_COMMITTER_EMAIL', 'test@example.com');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

async function archive(...args: string[]): Promise<string> {
  const deps = captureDeps(dir);
  await createProgram(deps).parseAsync(['node', 'specrun', 'archive', ...args]);
  return deps.out.join('');
}

describe('specrun archive', () => {
  it('archives a finished spec and says what it kept', async () => {
    const specDir = writeDemoSpec(dir);
    writeFileSync(
      join(specDir, 'events.jsonl'),
      doneTask('D-1', 10, 0.3) + doneTask('D-2', 5, 0.1),
    );
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', 'spec'], { cwd: dir });

    const output = await archive('demo');

    expect(output).toMatch(
      /^Archived demo → specrun\/specs\/archive\/demo \(commit [0-9a-f]{7}\)\n/,
    );
    expect(output).toContain('history.json: 2 task samples, 0 deviations');
    expect(existsSync(specDir)).toBe(false);
  });

  it('fails on an unknown spec', async () => {
    writeDemoSpec(dir);
    await expect(archive('nope')).rejects.toMatchObject({ code: 'spec-missing' });
  });
});
