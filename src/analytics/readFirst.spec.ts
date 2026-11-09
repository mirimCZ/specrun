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

  it('returns nothing without the section', () => {
    expect(parseReadFirst('# T\n\n## Changes\n- `a.ts`\n')).toEqual([]);
  });
});
