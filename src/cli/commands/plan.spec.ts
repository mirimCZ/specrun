import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureDeps, makeTempRepo } from '../../../test/fixtures/specRepo.js';
import { readEvents } from '../../events/eventStore.js';
import { runCommand, type InteractiveResult } from '../../process/run.js';
import { register } from './plan.js';

let dir: string;
let claude: string;
beforeEach(() => {
  dir = makeTempRepo();
  claude = join(dir, 'claude-config');
  writeFileSync(
    join(dir, 'specrun.config.json'),
    JSON.stringify({ verify: [{ name: 'ok', command: 'true' }], specsDir: 'spec' }),
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function writeTranscript(sessionId: string): void {
  const folder = join(claude, 'projects', 'p');
  mkdirSync(folder, { recursive: true });
  const line = {
    type: 'assistant',
    message: {
      id: 'm1',
      model: 'opus',
      usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 5000 },
    },
  };
  writeFileSync(join(folder, `${sessionId}.jsonl`), `${JSON.stringify(line)}\n`);
}

async function plan(
  args: string[],
  {
    interactive = true,
    result = { code: 0, error: null } as InteractiveResult,
    id = 'sid-1',
    writeSpec = false,
    message = null as string | null,
  } = {},
): Promise<{ launches: (readonly string[])[]; exit: number[]; out: string; err: string }> {
  const deps = { ...captureDeps(dir), interactive };
  const launches: (readonly string[])[] = [];
  const exit: number[] = [];
  const program = new Command('specrun');
  register(program, deps, {
    launch: (_cmd, launchArgs) => {
      launches.push(launchArgs);
      if (writeSpec) writeValidSpec();
      if (message !== null) writeFileSync(commitFile(), message);
      return Promise.resolve(result);
    },
    run: runCommand,
    setExitCode: (c) => void exit.push(c),
    newSessionId: () => id,
    claudeConfigDir: claude,
  });
  await program.parseAsync(['node', 'specrun', 'plan', ...args]);
  return { launches, exit, out: deps.out.join(''), err: deps.err.join('') };
}

const eventsFile = (): string => join(dir, 'spec', '001-demo', 'events.jsonl');

const commitFile = (): string => join(dir, '.specrun', 'plan', '001-demo.commit');

const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();

function initGit(): void {
  rmSync(join(dir, '.git'), { recursive: true });
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
}

/** A spec that loads: one task with its brief. */
function writeValidSpec(): void {
  const spec = join(dir, 'spec', '001-demo');
  mkdirSync(join(spec, 'tasks'), { recursive: true });
  writeFileSync(
    join(spec, 'tasks.yaml'),
    'title: Demo\ntasks:\n  - { id: D-1, title: One, phase: 1, needs: [], model: default, size: S }\n',
  );
  writeFileSync(join(spec, 'tasks', 'D-1.md'), '# D-1\n');
}

describe('specrun plan', () => {
  it('creates the folder and context, launches, and records the session', async () => {
    writeTranscript('sid-1');
    writeFileSync(join(dir, 'req.md'), 'Do X');
    const { launches, exit, out } = await plan(['-n', 'demo', '-f', 'req.md'], {
      result: { code: 4, error: null },
    });

    expect(launches[0]).toEqual([
      '--session-id',
      'sid-1',
      '-n',
      'plan 001-demo',
      '--append-system-prompt-file',
      join(dir, '.specrun', 'plan', '001-demo.md'),
      '/specrun:plan 001-demo',
    ]);
    const context = readFileSync(join(dir, '.specrun', 'plan', '001-demo.md'), 'utf8');
    expect(context).toContain('<request>\nDo X\n</request>');
    const event = readEvents(eventsFile()).events.at(-1);
    expect(event).toMatchObject({
      t: 'plan.session',
      runId: 'plan-sid-1',
      sessionId: 'sid-1',
      resumed: false,
      exitCode: 4,
      metrics: { turns: 1, inputTokens: 10, outputTokens: 20, cacheRead: 5000 },
    });
    expect(out).toContain('1 turns');
    expect(out).toContain('No tasks.yaml yet — specrun plan -n demo continues');
    expect(exit).toEqual([4]);
  });

  it('records null metrics and warns without a transcript', async () => {
    const { err, out } = await plan(['-n', 'demo']);
    expect(err).toContain('warning');
    expect(out).toContain('no transcript found');
    expect(readEvents(eventsFile()).events.at(-1)).toMatchObject({ metrics: null });
  });

  it('leaves an invalid spec uncommitted', async () => {
    initGit();
    mkdirSync(join(dir, 'spec', '001-demo'), { recursive: true });
    writeFileSync(join(dir, 'spec', '001-demo', 'tasks.yaml'), 'x');
    const { out, err } = await plan(['-n', 'demo']);
    expect(err).toContain('not committed');
    expect(out).toContain('Fix it (specrun status 001-demo)');
    expect(git('rev-list', '--count', 'HEAD')).toBe('1');
  });

  it('commits only the written spec folder on HEAD, then updates it', async () => {
    initGit();
    writeFileSync(join(dir, 'other.txt'), 'unrelated\n');
    const { out } = await plan(['-n', 'demo'], { writeSpec: true });
    expect(out).toMatch(/Committed spec\/001-demo \(commit [0-9a-f]{7}\) — next: specrun run/);
    expect(git('log', '-1', '--format=%s%n%b')).toBe(
      'docs(001-demo): plan spec\nSpecrun-Plan-Session: sid-1',
    );
    expect(git('show', '--name-only', '--format=', 'HEAD').split('\n').sort()).toEqual([
      'spec/001-demo/events.jsonl',
      'spec/001-demo/tasks.yaml',
      'spec/001-demo/tasks/D-1.md',
    ]);
    expect(git('status', '--porcelain')).toContain('other.txt');

    await plan(['-n', 'demo'], { id: 'sid-2' });
    expect(git('log', '-1', '--format=%s')).toBe('docs(001-demo): update spec');
  });

  it("commits with the skill's message and drops a stale one before the next session", async () => {
    initGit();
    const { launches } = await plan(['-n', 'demo'], {
      writeSpec: true,
      message: 'docs(001-demo): plan the demo flow\n\nTwo phases, one task.\n',
    });
    expect(git('log', '-1', '--format=%B')).toBe(
      'docs(001-demo): plan the demo flow\n\nTwo phases, one task.\n\nSpecrun-Plan-Session: sid-1',
    );
    expect(existsSync(commitFile())).toBe(false);

    mkdirSync(join(dir, '.specrun', 'plan'), { recursive: true });
    writeFileSync(commitFile(), 'docs: stale\n');
    await plan(['-n', 'demo'], { id: 'sid-2' });
    expect(git('log', '-1', '--format=%s')).toBe('docs(001-demo): update spec');
    expect(launches).toHaveLength(1);
  });

  it('warns when the commit fails', async () => {
    writeValidSpec();
    const { out, err } = await plan(['-n', 'demo']);
    expect(err).toContain('warning: could not commit spec/001-demo');
    expect(out).toContain('Commit the spec folder (incl. events.jsonl) before specrun run');
  });

  it('resumes the latest session, and errors without one', async () => {
    await expect(plan(['-n', 'demo', '--resume'])).rejects.toThrow('No earlier planning session');
    await plan(['-n', 'demo'], { id: 'first' });
    await plan(['-n', 'demo'], { id: 'second' });
    const { launches } = await plan(['-n', 'demo', '--resume']);
    expect(launches[0]?.slice(0, 2)).toEqual(['--resume', 'second']);
    expect(launches[0]?.at(-1)).toBe('Continue planning 001-demo.');
    expect(readEvents(eventsFile()).events.at(-1)).toMatchObject({ resumed: true });
  });

  it('--print creates nothing', async () => {
    const { launches, out, exit } = await plan(['-n', 'demo', '--print'], { interactive: false });
    expect(launches).toEqual([]);
    expect(exit).toEqual([]);
    expect(out).toContain('No request file — ask the user for the request.');
    expect(out).toContain('/specrun:plan 001-demo');
    expect(existsSync(join(dir, 'spec'))).toBe(false);
    expect(existsSync(join(dir, '.specrun'))).toBe(false);
  });

  it('--file reads an absolute path', async () => {
    const file = join(dir, 'abs-req.md');
    writeFileSync(file, 'ABSOLUTE REQUEST');
    const { out } = await plan(['-n', 'demo', '--print', '--file', file], { interactive: false });
    expect(out).toMatch(/<request>[\s\S]*ABSOLUTE REQUEST[\s\S]*<\/request>/);
  });

  it('--file resolves a relative path against the cwd', async () => {
    writeFileSync(join(dir, 'rel-req.md'), 'RELATIVE REQUEST');
    const { out } = await plan(['-n', 'demo', '--print', '--file', 'rel-req.md'], {
      interactive: false,
    });
    expect(out).toMatch(/<request>[\s\S]*RELATIVE REQUEST[\s\S]*<\/request>/);
  });

  it('--file throws spec-invalid naming a missing file', async () => {
    await expect(
      plan(['-n', 'demo', '--print', '--file', 'missing.md'], { interactive: false }),
    ).rejects.toMatchObject({
      code: 'spec-invalid',
      message: expect.stringContaining('missing.md'),
    });
  });

  it('needs a terminal', async () => {
    await expect(plan(['-n', 'demo'], { interactive: false })).rejects.toThrow('needs a terminal');
    expect(existsSync(join(dir, 'spec'))).toBe(false);
  });

  it('explains a missing claude binary', async () => {
    await expect(
      plan(['-n', 'demo'], { result: { code: -1, error: 'spawn claude ENOENT' } }),
    ).rejects.toThrow('Could not start claude');
  });
});
