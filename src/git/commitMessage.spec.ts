import { describe, expect, it } from 'vitest';
import { buildCommitMessage } from './commitMessage.js';

const payload = { commitMessage: 'feat(git): add worktree', summary: 'Did the thing.\n' };

describe('buildCommitMessage', () => {
  it('appends the task id when the subject lacks it', () => {
    const parts = buildCommitMessage({ task: 'SR-3', sessionId: 's1', payload, trailers: [] });
    expect(parts.subject).toBe('feat(git): add worktree (SR-3)');
    expect(parts.body).toBe('Did the thing.');
  });

  it('keeps the subject when it already names the task', () => {
    const parts = buildCommitMessage({
      task: 'SR-3',
      sessionId: 's1',
      payload: { ...payload, commitMessage: 'feat(git): worktree (SR-3)' },
      trailers: [],
    });
    expect(parts.subject).toBe('feat(git): worktree (SR-3)');
  });

  it('orders trailers: task, session, then configured ones', () => {
    const parts = buildCommitMessage({
      task: 'SR-3',
      sessionId: 's1',
      payload,
      trailers: ['Reviewed-by: Bot'],
    });
    expect(parts.trailers).toEqual([
      'Specrun-Task: SR-3',
      'Specrun-Session: s1',
      'Reviewed-by: Bot',
    ]);
  });
});
