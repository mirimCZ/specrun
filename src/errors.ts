export type SpecrunErrorCode =
  | 'config-invalid'
  | 'config-missing'
  | 'spec-invalid'
  | 'spec-missing'
  | 'repo-missing'
  | 'events-invalid'
  | 'git-failed'
  | 'setup-failed'
  | 'branch-protected';

/** User-facing failure; the CLI prints `message` and exits non-zero. */
export class SpecrunError extends Error {
  override readonly name = 'SpecrunError';
  readonly code: SpecrunErrorCode;
  readonly summary: string;
  /** One line per problem, so a user can fix all of them in one pass. */
  readonly details: string[];

  constructor(code: SpecrunErrorCode, summary: string, details: string[] = []) {
    super([summary, ...details.map((detail) => `  - ${detail}`)].join('\n'));
    this.code = code;
    this.summary = summary;
    this.details = details;
  }
}
