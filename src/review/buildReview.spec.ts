import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildReview, REVIEW_PROMPT_PATH } from './buildReview.js';

describe('buildReview', () => {
  it('ships the instructions next to the module', () => {
    expect(existsSync(REVIEW_PROMPT_PATH)).toBe(true);
    expect(buildReview({ command: 'c', listing: 'l', specs: [] }).systemPrompt).toContain(
      'AskUserQuestion',
    );
  });

  it('puts the listing and where each spec lives into the first message', () => {
    const { systemPrompt, message } = buildReview({
      command: 'specrun deviations traits',
      listing: 'scope (1)\n  traits/TR-1 [scope] x — y\n',
      instructions: 'INSTRUCTIONS',
      specs: [
        {
          kind: 'live',
          name: 'traits',
          files: '.specrun/worktrees/traits/docs/traits',
          worktree: '.specrun/worktrees/traits',
          branch: 'specrun/traits',
        },
        { kind: 'live', name: 'maps', files: 'docs/maps', worktree: null, branch: 'feat/maps' },
        {
          kind: 'archived',
          name: 'old',
          files: 'docs/archive/old',
          commit: 'abcdef1234',
          original: 'docs/old',
        },
      ],
    });
    expect(systemPrompt).toBe('INSTRUCTIONS');
    expect(message).toBe(
      [
        "Let's review these deviations together (`specrun deviations traits`):",
        '',
        'scope (1)\n  traits/TR-1 [scope] x — y',
        '',
        'Spec files:',
        '- traits: .specrun/worktrees/traits/docs/traits — branch specrun/traits, worktree .specrun/worktrees/traits (the next run reads this copy)',
        '- maps: docs/maps — branch feat/maps, no worktree',
        '- old: archived in docs/archive/old — full spec at commit abcdef1 (docs/old)',
      ].join('\n'),
    );
  });
});
