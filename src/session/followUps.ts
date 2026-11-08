// Fixed texts the runner sends when it resumes a task session (SRD-6, SRD-9).

const END_WITH_A_TOOL =
  'End the session by calling complete_task, or block_task if you cannot finish.';

/** `round` counts fix rounds from 1; the runner gives up after `maxRounds`. */
export function verifyFailedPrompt(summary: string, round: number, maxRounds: number): string {
  const last =
    round >= maxRounds ? ' This is the last round: if it fails again, the task is blocked.' : '';
  return [
    `Verification failed — fix round ${round} of ${maxRounds}.${last}`,
    'Fix the failures below in this session, run the failing checks yourself, then call ' +
      'complete_task again (with the full notes and deviations, including any new ones).',
    '',
    summary.trim(),
  ].join('\n');
}

export function limitResumePrompt(): string {
  return [
    'The session was paused because the plan usage limit was reached; the limit has reset.',
    'Continue the task where you stopped. A command that was running may not have finished — ' +
      'run it again. ' +
      END_WITH_A_TOOL,
  ].join('\n');
}

export function crashResumePrompt(): string {
  return [
    'The runner was interrupted while this session was running and has restarted.',
    'The working tree is as you left it. Check its state (read-only git commands such as ' +
      '`git status` and `git diff` are fine), then continue the task. ' +
      END_WITH_A_TOOL,
  ].join('\n');
}

export function noCallNudgePrompt(): string {
  return [
    'You ended without calling complete_task or block_task — nothing was recorded.',
    'If the task is done, call complete_task now. If it is not, finish it first. ' +
      'If you cannot finish it, call block_task with the exact reason.',
  ].join('\n');
}
