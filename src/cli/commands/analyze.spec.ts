import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assistantMessage,
  initMessage,
  toolResultMessage,
} from '../../../test/fixtures/sdkMessages.js';
import { captureDeps, makeTempRepo, writeDemoSpec } from '../../../test/fixtures/specRepo.js';
import { doneTask } from '../../../test/fixtures/taskEvents.js';
import { createTranscriptWriter } from '../../session/transcript.js';
import { AnalyzeJsonSchema } from '../../stats/jsonOutput.js';
import { createProgram } from '../program.js';

let dir: string;
let transcripts: string;
let eventsFile: string;
beforeEach(() => {
  dir = makeTempRepo();
  transcripts = join(dir, 'transcripts');
  const specDir = writeDemoSpec(dir);
  writeFileSync(
    join(dir, 'specrun.config.json'),
    JSON.stringify({ verify: [{ name: 'ok', command: 'true' }], transcriptsDir: transcripts }),
  );
  writeFileSync(join(specDir, 'tasks', 'D-1.md'), '# D-1\n\n## Read first\n\n- `src/a.ts`\n');
  eventsFile = join(specDir, 'events.jsonl');
  writeFileSync(eventsFile, doneTask('D-1', 3, 0.2));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function analyze(...args: string[]): Promise<{ out: string; err: string }> {
  const deps = captureDeps(dir);
  await createProgram(deps).parseAsync(['node', 'specrun', 'analyze', ...args]);
  return { out: deps.out.join(''), err: deps.err.join('') };
}

async function writeTranscript(): Promise<void> {
  const file = join(transcripts, basename(dir), 'demo', 'D-1', 's-D-1-0.jsonl.gz');
  mkdirSync(dirname(file), { recursive: true });
  const writer = createTranscriptWriter(file);
  writer.write(initMessage({ sessionId: 's-D-1' }));
  writer.write(
    assistantMessage({
      id: 'msg_1',
      usage: { input: 100, output: 5 },
      toolUses: [
        { name: 'Read', input: { file_path: '/work/src/b.ts' }, id: 'toolu_1' },
        { name: 'Edit', input: { file_path: '/work/src/c.ts' }, id: 'toolu_2' },
      ],
    }),
  );
  writer.write(toolResultMessage({ toolUseId: 'toolu_1', text: 'x'.repeat(500) }));
  writer.write(toolResultMessage({ toolUseId: 'toolu_2', text: 'ok' }));
  await writer.close();
}

describe('specrun analyze', () => {
  it('says so when no analytics exist', async () => {
    expect((await analyze()).out).toContain('No analytics recorded yet');
  });

  it('warns about missing transcripts on --reindex', async () => {
    const { out, err } = await analyze('demo', '--reindex');
    expect(err).toContain('transcript missing');
    expect(out).toContain('Appended 0');
  });

  it('reindexes a transcript, appends an event and summarizes it', async () => {
    await writeTranscript();
    const { out } = await analyze('demo', '--reindex');
    expect(out).toContain('Appended 1');
    expect(readFileSync(eventsFile, 'utf8')).toContain('"t":"analytics.session"');
    expect(out).toContain('demo/D-1');
    expect(out).toContain('unread Read-first files: src/a.ts');
    expect(out).toContain('(estimate)');

    const json = AnalyzeJsonSchema.parse(JSON.parse((await analyze('demo', '--json')).out));
    const task = json.specs[0]?.tasks[0];
    expect(task).toMatchObject({ task: 'D-1', segments: 1, unreadFirst: ['src/a.ts'] });
    // src/c.ts was only edited: no result to rank.
    expect(task?.topFiles).toEqual([{ path: 'src/b.ts', resultChars: 500 }]);
  });

  it('refuses to reindex while a run holds the lock', async () => {
    mkdirSync(join(dir, '.specrun', 'locks'), { recursive: true });
    writeFileSync(join(dir, '.specrun', 'locks', 'demo.lock'), `${process.pid}\n`);
    await expect(analyze('demo', '--reindex')).rejects.toThrow('holds the lock');
  });
});
