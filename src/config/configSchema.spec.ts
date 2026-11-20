import { describe, expect, it } from 'vitest';
import { ConfigSchema, DEFAULT_SIZES, SizeSchema } from './configSchema.js';

const verify = [{ name: 'test', command: 'npm test' }];

describe('ConfigSchema', () => {
  it('fills every default for a minimal config', () => {
    expect(ConfigSchema.parse({ verify })).toEqual({
      specsDir: 'specrun/specs',
      featuresDir: 'specrun/features',
      verify,
      verifyFinal: [],
      setup: null,
      worktree: true,
      worktreeFiles: [],
      models: { default: 'sonnet', strong: 'opus' },
      maxTurns: 150,
      verifyFixRounds: 2,
      limits: { sessionMinLeft: 15, weeklyMinLeft: 5, accounts: {} },
      sizes: DEFAULT_SIZES,
      transcriptsDir: '~/.specrun/runs',
      commitTrailers: [],
    });
  });

  it('keeps the remaining defaults of a partially overridden nested object', () => {
    const config = ConfigSchema.parse({
      verify,
      models: { strong: 'claude-opus-5-5' },
      sizes: { M: { turns: [5, 8], usd: 0.5 } },
    });
    expect(config.models).toEqual({ default: 'sonnet', strong: 'claude-opus-5-5' });
    expect(config.sizes).toEqual({ ...DEFAULT_SIZES, M: { turns: [5, 8], usd: 0.5 } });
  });

  it('accepts a custom featuresDir and rejects an empty one', () => {
    expect(ConfigSchema.parse({ verify, featuresDir: 'spec/features' }).featuresDir).toBe(
      'spec/features',
    );
    expect(ConfigSchema.safeParse({ verify, featuresDir: '' }).success).toBe(false);
  });

  it('rejects unknown keys, also nested ones', () => {
    expect(ConfigSchema.safeParse({ verify, verifyRounds: 3 }).success).toBe(false);
    expect(ConfigSchema.safeParse({ verify, models: { fast: 'haiku' } }).success).toBe(false);
  });

  it('defaults limits.accounts to {} and parses a partial override', () => {
    expect(ConfigSchema.parse({ verify, limits: { sessionMinLeft: 20 } }).limits.accounts).toEqual(
      {},
    );
    const config = ConfigSchema.parse({
      verify,
      limits: { accounts: { lorem: { weeklyMinLeft: 2 } } },
    });
    expect(config.limits).toEqual({
      sessionMinLeft: 15,
      weeklyMinLeft: 5,
      accounts: { lorem: { weeklyMinLeft: 2 } },
    });
  });

  it('rejects an unknown key or an out-of-range value inside an account override', () => {
    const parse = (override: unknown): boolean =>
      ConfigSchema.safeParse({ verify, limits: { accounts: { lorem: override } } }).success;
    expect(parse({ sessionMin: 10 })).toBe(false);
    expect(parse({ sessionMinLeft: 101 })).toBe(false);
  });

  it('requires at least one verify step', () => {
    expect(ConfigSchema.safeParse({}).success).toBe(false);
    expect(ConfigSchema.safeParse({ verify: [] }).success).toBe(false);
  });
});

describe('SizeSchema', () => {
  it('accepts min equal to max', () => {
    expect(SizeSchema.parse({ turns: [10, 10], usd: 1 })).toEqual({ turns: [10, 10], usd: 1 });
  });

  it('rejects turns with min > max', () => {
    expect(SizeSchema.safeParse({ turns: [30, 20], usd: 1 }).success).toBe(false);
  });

  it('rejects a non-positive usd', () => {
    expect(SizeSchema.safeParse({ turns: [10, 20], usd: 0 }).success).toBe(false);
  });
});
