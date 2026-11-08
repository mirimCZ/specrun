import { describe, expect, it } from 'vitest';
import {
  crashResumePrompt,
  limitResumePrompt,
  noCallNudgePrompt,
  verifyFailedPrompt,
} from './followUps.js';

describe('verifyFailedPrompt', () => {
  it('includes the round numbers and the summary', () => {
    const text = verifyFailedPrompt('test: 2 failed\n  foo.spec.ts > bar\n', 1, 3);
    expect(text).toContain('fix round 1 of 3');
    expect(text).toContain('test: 2 failed\n  foo.spec.ts > bar');
    expect(text).toContain('complete_task');
    expect(text).not.toContain('last round');
  });

  it('warns in the last round', () => {
    expect(verifyFailedPrompt('x', 2, 2)).toContain('fix round 2 of 2. This is the last round');
  });
});

describe('resume prompts', () => {
  it.each([
    ['limitResumePrompt', limitResumePrompt],
    ['crashResumePrompt', crashResumePrompt],
    ['noCallNudgePrompt', noCallNudgePrompt],
  ])('%s points at both tools', (_, prompt) => {
    expect(prompt()).toContain('complete_task');
    expect(prompt()).toContain('block_task');
  });

  it('nudges a session that ended without a call', () => {
    expect(noCallNudgePrompt()).toMatch(/^You ended without calling complete_task or block_task/);
  });
});
