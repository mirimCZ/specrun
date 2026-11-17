import { existsSync, readFileSync } from 'node:fs';

export interface PlanCommitMessage {
  subject: string;
  body: string;
}

/** First non-empty line is the subject, the rest the body; null when there is no subject. */
export function parsePlanCommitMessage(text: string): PlanCommitMessage | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => line.trim() !== '');
  if (start === -1) return null;
  return {
    subject: (lines[start] ?? '').trim(),
    body: lines
      .slice(start + 1)
      .join('\n')
      .trim(),
  };
}

/** The message the plan skill proposed; null when it wrote none. */
export function readPlanCommitMessage(file: string): PlanCommitMessage | null {
  return existsSync(file) ? parsePlanCommitMessage(readFileSync(file, 'utf8')) : null;
}
