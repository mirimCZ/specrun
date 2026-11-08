export interface CommitPayload {
  commitMessage: string;
  summary: string;
}

export interface BuildCommitMessageInput {
  task: string;
  sessionId: string;
  payload: CommitPayload;
  /** Extra trailers from the config (`commitTrailers`), verbatim `Key: value` lines. */
  trailers: readonly string[];
}

export interface CommitMessageParts {
  subject: string;
  body: string;
  trailers: string[];
}

/** SRD-24: subject gets ` (<TASK>)` unless it already names the task. */
export function buildCommitMessage(input: BuildCommitMessageInput): CommitMessageParts {
  const message = input.payload.commitMessage.trim();
  const subject = message.includes(input.task) ? message : `${message} (${input.task})`;
  return {
    subject,
    body: input.payload.summary.trim(),
    trailers: [
      `Specrun-Task: ${input.task}`,
      `Specrun-Session: ${input.sessionId}`,
      ...input.trailers,
    ],
  };
}
