import { describe, expect, it } from 'vitest';
import { parseReadFirst } from './readFirst.js';

describe('parseReadFirst', () => {
  it('parses bullets with several paths, hints and skips common files and non-paths', () => {
    const brief = [
      '# T',
      '',
      '## Read first',
      '',
      '- `CLAUDE.md`, `docs/testing.md` (git in tests).',
      '- SR-1 notes below — `Config`, `LoadedSpec`, `SpecrunError`.',
      '- `src/a.ts` + `src/b.ts` — both; `src/c.ts:10-20` lines.',
      '- `tools/spec-verify.sh` `report_failure` — which lines; `analytics.session` schema.',
      '- `docs/v1/tasks/SR-3.md` "Read first" section, `npm test`.',
      '',
      '## Changes',
      '',
      '- `src/not/here.ts`',
    ].join('\n');
    expect(parseReadFirst(brief)).toEqual([
      'src/a.ts',
      'src/b.ts',
      'src/c.ts',
      'tools/spec-verify.sh',
      'docs/v1/tasks/SR-3.md',
    ]);
  });

  it('resolves shortened siblings, brace groups, continuation lines and nested bullets', () => {
    const brief = [
      '## Read first',
      '',
      '- `lorem/ipsum/Dolor.tsx` + `.spec.tsx`, `Sit.tsx` — the steps (lines',
      '  10–20), `Amet.ts` too',
      '  - `Dolor.test.ts`',
      '- `lorem/locales/{cs,en}/common.json` — keys',
      '- `docs/features/board/a.md`, `board/b.md`,',
      '  `rooms/c.md`',
      '- `src/x.ts`, `src/y.ts`',
    ].join('\n');
    expect(parseReadFirst(brief)).toEqual([
      'lorem/ipsum/Dolor.tsx',
      'lorem/ipsum/Dolor.spec.tsx',
      'lorem/ipsum/Sit.tsx',
      'lorem/ipsum/Amet.ts',
      'lorem/ipsum/Dolor.test.ts',
      'lorem/locales/cs/common.json',
      'lorem/locales/en/common.json',
      'docs/features/board/a.md',
      'docs/features/board/b.md',
      'docs/features/rooms/c.md',
      'src/x.ts',
      'src/y.ts',
    ]);
  });

  it('returns nothing without the section', () => {
    expect(parseReadFirst('# T\n\n## Changes\n- `a.ts`\n')).toEqual([]);
  });
});
