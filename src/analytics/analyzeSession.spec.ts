import { describe, expect, it } from 'vitest';
import {
  assistantMessage,
  initMessage,
  toolResultMessage,
} from '../../test/fixtures/sdkMessages.js';
import { analyzeSession, testPatternsFor } from './analyzeSession.js';

const read = (path: string, id: string) => ({ name: 'Read', input: { file_path: path }, id });

describe('analyzeSession', () => {
  it('builds the context curve and peak per API message id', () => {
    const m = analyzeSession(
      [
        initMessage(),
        assistantMessage({ id: 'a', usage: { input: 10, cacheRead: 100, output: 1 } }),
        // A second streamed block of the same turn with the final usage.
        assistantMessage({ id: 'a', usage: { input: 10, cacheRead: 100, output: 20 } }),
        assistantMessage({
          id: 'b',
          usage: { input: 5, cacheRead: 300, cacheWrite: 50, output: 7 },
        }),
        assistantMessage({ id: 'sub', parentToolUseId: 'x', usage: { input: 9999 } }),
      ],
      { readFirst: null },
    );
    expect(m.turns).toEqual([
      { n: 1, context: 110, cacheRead: 100, cacheWrite: 0, output: 20, tools: [] },
      { n: 2, context: 355, cacheRead: 300, cacheWrite: 50, output: 7, tools: [] },
    ]);
    expect(m.peakContext).toBe(355);
    expect(m.estimate).toBe(true);
    expect(m.brief).toBeNull();
  });

  it('aggregates tools and files, counts re-reads, relativizes paths, ranks Bash', () => {
    const m = analyzeSession(
      [
        initMessage(),
        assistantMessage({ id: '1', toolUses: [read('/work/src/a.ts', 't1')] }),
        toolResultMessage({ toolUseId: 't1', text: 'x'.repeat(400) }),
        assistantMessage({ id: '2', toolUses: [read('/work/src/a.ts', 't2')] }),
        toolResultMessage({ toolUseId: 't2', text: 'y'.repeat(100) }),
        assistantMessage({
          id: '3',
          toolUses: [
            { name: 'Edit', input: { file_path: '/work/src/a.ts' }, id: 't3' },
            { name: 'Bash', input: { command: 'ls' }, id: 't4' },
          ],
        }),
        toolResultMessage({ toolUseId: 't3', text: 'ok' }),
        toolResultMessage({ toolUseId: 't4', text: 'z'.repeat(50) }),
        assistantMessage({
          id: '4',
          toolUses: [{ name: 'Bash', input: { command: `echo ${'q'.repeat(200)}` }, id: 't5' }],
        }),
        toolResultMessage({ toolUseId: 't5', text: 'z'.repeat(900) }),
      ],
      { readFirst: null },
    );
    expect(m.rereads).toBe(1);
    expect(m.files).toEqual([{ path: 'src/a.ts', reads: 2, edits: 1, resultChars: 500 }]);
    expect(m.tools.find((t) => t.name === 'Read')).toEqual({
      name: 'Read',
      calls: 2,
      resultChars: 500,
    });
    expect(m.bash.map((b) => [b.command.length, b.outputChars])).toEqual([
      [120, 900],
      [2, 50],
    ]);
  });

  it('reports brief files read, unread and extra', () => {
    const m = analyzeSession(
      [
        initMessage(),
        assistantMessage({
          id: '1',
          toolUses: [
            read('/work/src/a.ts', 't1'),
            read('/work/src/other.ts', 't2'),
            read('/work/CLAUDE.md', 't3'),
          ],
        }),
      ],
      { readFirst: ['src/a.ts', 'src/b.ts'] },
    );
    expect(m.brief).toEqual({
      readFirst: ['src/a.ts', 'src/b.ts'],
      read: ['src/a.ts'],
      unread: ['src/b.ts'],
      extraReads: ['src/other.ts'],
    });
  });

  it('splits turns into orient, implement, test and fix', () => {
    const turn = (id: string, toolUses: { name: string; input: unknown; id: string }[]) =>
      assistantMessage({ id, usage: { input: 10, output: 0 }, toolUses });
    const bash = (command: string, id: string) => ({ name: 'Bash', input: { command }, id });
    const messages = [
      initMessage(),
      turn('1', [read('/work/a.ts', 'r1')]),
      turn('2', [{ name: 'Write', input: { file_path: '/work/a.ts' }, id: 'w' }]),
      turn('3', [bash('npx vitest run', 'b1')]),
      turn('4', [bash('git status', 'b2')]),
      turn('5', [bash('npm run typecheck', 'b3')]),
    ];
    const phases = analyzeSession(messages, { readFirst: null, fixFromTurn: 5 }).phases;
    expect(phases).toEqual({
      orient: { turns: 1, tokens: 10 },
      implement: { turns: 2, tokens: 20 },
      test: { turns: 1, tokens: 10 },
      fix: { turns: 1, tokens: 10 },
    });
    const all = analyzeSession(messages, { readFirst: null, fixFromTurn: 1 }).phases;
    expect(all.fix.turns).toBe(5);
  });

  it('reads and edits through Bash, carrying cd over between calls like Claude Code', () => {
    const bash = (command: string, id: string) => ({ name: 'Bash', input: { command }, id });
    const m = analyzeSession(
      [
        initMessage(),
        assistantMessage({ id: '1', toolUses: [bash('cd lorem && sed -n 1,40p a.ts', 'b1')] }),
        toolResultMessage({ toolUseId: 'b1', text: 'x'.repeat(300) }),
        // Still in lorem/: the failed cd changes nothing.
        assistantMessage({ id: '2', toolUses: [bash('cd lorem; cat b.ts c.ts', 'b2')] }),
        toolResultMessage({
          toolUseId: 'b2',
          text: '(eval):cd:1: no such file or directory: lorem\n' + 'y'.repeat(100),
        }),
        assistantMessage({ id: '3', toolUses: [bash("sed -i '' 's/a/b/' a.ts", 'b3')] }),
        // Leaving the worktree puts the shell back into it; /tmp is scratch, not an edit.
        assistantMessage({ id: '4', toolUses: [bash('cd /tmp && cat > x.log <<E\nx\nE', 'b4')] }),
        assistantMessage({ id: '5', toolUses: [bash('cat ipsum/d.ts', 'b5')] }),
      ],
      { readFirst: ['lorem/a.ts', 'lorem/b.ts', 'ipsum/'] },
    );
    expect(m.files).toEqual([
      { path: 'lorem/a.ts', reads: 1, edits: 1, resultChars: 300 },
      { path: 'lorem/b.ts', reads: 1, edits: 0, resultChars: 0 },
      { path: 'lorem/c.ts', reads: 1, edits: 0, resultChars: 0 },
      { path: 'ipsum/d.ts', reads: 1, edits: 0, resultChars: 0 },
    ]);
    expect(m.rereads).toBe(0);
    expect(m.brief?.unread).toEqual([]);
    expect(m.phases.orient.turns).toBe(2);
    expect(m.phases.implement.turns).toBe(3);
  });

  it('counts the project verify commands and nx test targets as tests', () => {
    const patterns = testPatternsFor(['make check']);
    const bash = (command: string, id: string) => ({ name: 'Bash', input: { command }, id });
    const m = analyzeSession(
      [
        initMessage(),
        assistantMessage({ id: '1', toolUses: [bash('echo x > src/a.ts', 'b1')] }),
        assistantMessage({ id: '2', toolUses: [bash('make check', 'b2')] }),
        assistantMessage({ id: '3', toolUses: [bash('npx nx run lorem:test -- src', 'b3')] }),
      ],
      { readFirst: null, testPatterns: patterns },
    );
    expect(m.phases.implement.turns).toBe(1);
    expect(m.phases.test.turns).toBe(2);
  });
});
