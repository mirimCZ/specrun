import { describe, expect, it } from 'vitest';
import { bashFileAccess } from './bashFiles.js';

describe('bashFileAccess', () => {
  it('reads what cat, head, tail and sed -n print, resolved against cd', () => {
    const access = bashFileAccess(
      'cd lorem/ipsum && cat a.ts b.tsx | head -40; sed -n 10,40p c.ts && head -n 5 d.md; tail -20 e.ts',
    );
    expect(access).toEqual({
      reads: [
        'lorem/ipsum/a.ts',
        'lorem/ipsum/b.tsx',
        'lorem/ipsum/c.ts',
        'lorem/ipsum/d.md',
        'lorem/ipsum/e.ts',
      ],
      edits: [],
      changesFiles: false,
      dir: 'lorem/ipsum',
    });
  });

  it('does not count search, globs, variables or unknown directories as reads', () => {
    expect(bashFileAccess('grep -rn "dolor" src/a.ts; cat src/*.ts $f; ls src').reads).toEqual([]);
    expect(bashFileAccess('cd $ROOT && cat a.ts', { dir: '/w' })).toMatchObject({
      reads: [],
      dir: null,
    });
    expect(bashFileAccess('cat /w/a.ts', { dir: null }).reads).toEqual(['/w/a.ts']);
  });

  it('edits through sed -i, perl -pi, tee and redirects, not through fd redirects', () => {
    const access = bashFileAccess(
      [
        "sed -i '' 's/lorem/ipsum/' a.ts",
        "sed -i.bak -e 's/x/y/' b.ts",
        "perl -pi -e 's/a/b/' c.ts",
        'echo x | tee -a d.md',
        'npx vitest run > e.log 2>&1',
        'npm test 2>/dev/null >&2',
      ].join('\n'),
    );
    expect(access.edits).toEqual(['a.ts', 'b.ts', 'c.ts', 'd.md', 'e.log']);
    expect(access.reads).toEqual([]);
    expect(access.changesFiles).toBe(true);
  });

  it('writes heredocs to the redirect target without reading their bodies as commands', () => {
    const access = bashFileAccess(
      "cd src && cat > lorem.spec.ts <<'EOF'\ncat ignored.ts\nsed -i 's/a/b/' ignored.ts\nEOF\ncat ipsum.ts",
    );
    expect(access).toMatchObject({
      reads: ['src/ipsum.ts'],
      edits: ['src/lorem.spec.ts'],
      changesFiles: true,
    });
  });

  it('edits through Python scripts that write, naming the path literals', () => {
    const script = [
      "python3 - <<'E'",
      "p='src/lorem.ts'",
      's=open(p).read()',
      's=s.replace("a","b")',
      "open(p,'w').write(s)",
      'E',
    ].join('\n');
    expect(bashFileAccess(script)).toMatchObject({ edits: ['src/lorem.ts'], changesFiles: true });

    const readOnly = "python3 - <<'E'\nprint(open('src/lorem.ts').read())\nE";
    expect(bashFileAccess(readOnly)).toMatchObject({ edits: [], changesFiles: false });

    const unnamed = `python3 -c "import pathlib; pathlib.Path(name).write_text('x')"`;
    expect(bashFileAccess(unnamed)).toMatchObject({ edits: [], changesFiles: true });
  });

  it('keeps the directory of a cd the output reports as failed', () => {
    const access = bashFileAccess('cd lorem && cat a.ts', {
      dir: '/w/lorem',
      failedCds: ['lorem'],
    });
    expect(access).toMatchObject({ reads: ['/w/lorem/a.ts'], dir: '/w/lorem' });
  });

  it('takes a repeated relative cd without an error as one from the worktree root', () => {
    const access = bashFileAccess('cd lorem/ipsum; cat a.ts', {
      dir: '/w/lorem/ipsum',
      root: '/w',
    });
    expect(access).toMatchObject({ reads: ['/w/lorem/ipsum/a.ts'], dir: '/w/lorem/ipsum' });
  });
});
