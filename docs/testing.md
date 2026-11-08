# Testing

vitest, specs co-located as `foo.spec.ts` next to `foo.ts`, descriptions in English. Example:
[`src/cli/program.spec.ts`](../src/cli/program.spec.ts).

## Rules

- **No real side effects outside a temp dir.** File-system tests create one with
  `mkdtempSync(join(tmpdir(), 'specrun-'))` in `beforeEach` and remove it with
  `rmSync(dir, { recursive: true, force: true })` in `afterEach`.
- **Never the real Agent SDK, network or `claude` CLI.** Session code takes an injected `query`
  function; runner code takes an injected `AgentSession` factory. Use the fakes in `test/fakes/`
  (created by the tasks that introduce the interfaces) and extend them rather than writing
  ad-hoc stubs per spec.
- **Time is injected.** Code that waits or timestamps takes a `Clock`
  (`now(): Date`, `sleep(ms): Promise<void>`); tests use the fake clock from `test/fakes/` —
  no `vi.useFakeTimers` around real `setTimeout`.
- **Prefer dependency injection to `vi.mock`.** Module mocking is a last resort (e.g. a
  third-party module with no seam) and must be explained in a comment.

## Git in tests

Create a real repository in the temp dir; set identity through env so the user's config is not
needed:

```ts
const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};
execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, env });
```

Worktree tests: `git worktree add` needs at least one commit on the base branch.

## SDK message fixtures

Analytics and session tests build SDK messages with the helpers in `test/fixtures/` (typed as
`SDKMessage` from `@anthropic-ai/claude-agent-sdk`, minimal fields + casts where the SDK type
requires more). Never commit real session transcripts — they contain project code and output.

## Ink

Components are tested with `ink-testing-library` (`render(<X />).lastFrame()`), asserting on
visible text, not on internal state.
