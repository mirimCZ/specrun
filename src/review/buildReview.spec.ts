import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildReview, REVIEW_PROMPT_PATH } from './buildReview.js';
import type { ReviewContext } from './reviewContext.js';

const context: ReviewContext = {
  config: '{ "verify": [] }\n',
  specs: [
    {
      name: 'traits',
      title: 'Traits',
      location: {
        kind: 'live',
        files: '.specrun/worktrees/traits/docs/traits',
        worktree: '.specrun/worktrees/traits',
        branch: 'specrun/traits',
        merged: false,
      },
      taskPrompt: null,
      readmePath: '.specrun/worktrees/traits/docs/traits/README.md',
      decisions: ['| TRD-3 | Rules | Never change firestore.rules |'],
      lastRow: { decision: 40, question: 70 },
      next: { task: 'TR-26', decision: 'TRD-41', question: 'Q9' },
      tasks: [
        {
          id: 'TR-6',
          title: 'Shapes',
          deviations: [
            {
              spec: 'traits',
              task: 'TR-6',
              kind: 'spec-bug',
              decision: null,
              what: 'changed firestore.rules',
              why: 'TRD-3 is about traits',
              question: null,
              reviewed: false,
            },
          ],
          briefPath: '.specrun/worktrees/traits/docs/traits/tasks/TR-6.md',
          brief: '# TR-6\n\n```ts\ncode\n```\n',
          commit: {
            sha: 'f334cff0000',
            message: 'feat(canvas): shapes (TR-6)',
            files: ['+7 −3 firestore.rules'],
            diffs: [{ path: 'firestore.rules', diff: '+allow write' }],
          },
        },
      ],
    },
    {
      name: 'old',
      title: 'Old',
      location: {
        kind: 'archived',
        files: 'specrun/specs/archive/old',
        commit: 'abcdef1234',
        original: 'specrun/specs/old',
      },
      taskPrompt: null,
      readmePath: 'specrun/specs/archive/old/README.md',
      decisions: [],
      lastRow: { decision: null, question: null },
      next: { task: null, decision: null, question: null },
      tasks: [
        {
          id: 'OLD-1',
          title: null,
          deviations: [],
          briefPath: 'abcdef1:specrun/specs/old/tasks/OLD-1.md',
          brief: null,
          commit: null,
        },
      ],
    },
  ],
};

describe('buildReview', () => {
  it('ships the instructions next to the module', () => {
    expect(existsSync(REVIEW_PROMPT_PATH)).toBe(true);
    const { systemPrompt } = buildReview({ command: 'c', listing: 'l', context });
    expect(systemPrompt).toContain('AskUserQuestion');
  });

  it('appends the gathered context to the instructions and opens with the listing', () => {
    const { systemPrompt, message } = buildReview({
      command: 'specrun review traits',
      listing: 'spec-bug (1)\n  traits/TR-6 [spec-bug] changed firestore.rules — TRD-3\n',
      instructions: 'INSTRUCTIONS\n',
      context,
    });
    expect(systemPrompt.startsWith('INSTRUCTIONS\n\n---\n\n# Review context')).toBe(true);
    for (const part of [
      '<config>\n{ "verify": [] }\n</config>',
      '## Spec traits — Traits',
      '- Branch specrun/traits: not merged into HEAD',
      '- Worktree .specrun/worktrees/traits — the next run reads this copy; edit the spec there.',
      '- README .specrun/worktrees/traits/docs/traits/README.md: decision log ends at line 40, resolved questions end at line 70',
      '- Next free IDs: decision TRD-41, question Q9, task TR-26',
      '| TRD-3 | Rules | Never change firestore.rules |',
      '### TR-6 Shapes',
      '- traits/TR-6 [spec-bug] changed firestore.rules — TRD-3 is about traits',
      'Commit f334cff:',
      '<commit-message>\nfeat(canvas): shapes (TR-6)\n</commit-message>',
      'Files changed:\n  +7 −3 firestore.rules',
      '<diff path="firestore.rules">\n+allow write\n</diff>',
      '<brief path=".specrun/worktrees/traits/docs/traits/tasks/TR-6.md">\n# TR-6\n\n```ts\ncode\n```\n</brief>',
      '- Archived in specrun/specs/archive/old; the full spec is at commit abcdef1 (specrun/specs/old).',
      '### OLD-1\n',
      'No commit (the task is not done).',
      'Brief abcdef1:specrun/specs/old/tasks/OLD-1.md: not included',
    ]) {
      expect(systemPrompt).toContain(part);
    }
    expect(message).toBe(
      "Let's review these deviations together (`specrun review traits`). The review context has the briefs, commits and decisions behind them.\n\n" +
        'spec-bug (1)\n  traits/TR-6 [spec-bug] changed firestore.rules — TRD-3',
    );
  });
});
