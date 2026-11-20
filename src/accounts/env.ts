export type ChildEnv = Readonly<Record<string, string | undefined>>;

const CREDENTIAL_VARIABLES = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
];

/** Child env for an account with a token (MAD-16); null: inherit process.env (system login). */
export function accountEnv(base: NodeJS.ProcessEnv, token: string | null): ChildEnv | null {
  if (token === null) return null;
  const env: Record<string, string | undefined> = { ...base };
  for (const name of CREDENTIAL_VARIABLES) delete env[name];
  env['CLAUDE_CODE_OAUTH_TOKEN'] = token;
  return env;
}
