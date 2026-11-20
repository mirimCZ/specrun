import { describe, expect, it } from 'vitest';
import { accountEnv } from './env.js';

describe('accountEnv', () => {
  const base = {
    ANTHROPIC_API_KEY: 'a',
    ANTHROPIC_AUTH_TOKEN: 'b',
    CLAUDE_CODE_OAUTH_TOKEN: 'c',
    LOREM: 'ipsum',
  };

  it('replaces the credential variables and keeps the others', () => {
    expect(accountEnv(base, 'lorem-token')).toEqual({
      LOREM: 'ipsum',
      CLAUDE_CODE_OAUTH_TOKEN: 'lorem-token',
    });
  });

  it('does not mutate the base', () => {
    const copy = { ...base };
    accountEnv(base, 'lorem-token');
    expect(base).toEqual(copy);
  });

  it('gives null for the system login', () => {
    expect(accountEnv(base, null)).toBeNull();
  });
});
