import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { SpecrunError } from '../errors.js';
import { AccountLimitsSchema } from './configSchema.js';
import { formatIssues, readJsonFile } from './loadConfig.js';

/** Relative to the home dir; shared by every repository on the machine (MAD-2). */
export const GLOBAL_CONFIG_FILE = '.specrun/config.json';

const GLOBAL_CONFIG_LABEL = `~/${GLOBAL_CONFIG_FILE}`;

/** Where an account's OAuth token comes from (MAD-5); resolving it is not this module's job. */
export const TokenSourceSchema = z.union([
  z.strictObject({ env: z.string().min(1) }),
  z.strictObject({ command: z.string().min(1) }),
]);
export type TokenSource = z.infer<typeof TokenSourceSchema>;

const AccountSchema = z.strictObject({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and dashes only'),
  /** Omitted: the account uses the system login of Claude Code. */
  token: TokenSourceSchema.optional(),
  limits: AccountLimitsSchema.optional(),
});

/** `accounts` order is the priority; the first one is the priority account (MAD-4). */
export const GlobalConfigSchema = z
  .strictObject({
    accounts: z.array(AccountSchema).default([]),
  })
  .superRefine((config, ctx) => {
    const seen = new Set<string>();
    let tokenless = false;
    config.accounts.forEach((account, index) => {
      if (seen.has(account.name)) {
        ctx.addIssue({
          code: 'custom',
          path: ['accounts', index, 'name'],
          message: `duplicate account name "${account.name}"`,
        });
      }
      seen.add(account.name);
      if (account.token === undefined) {
        if (tokenless) {
          ctx.addIssue({
            code: 'custom',
            path: ['accounts', index],
            message: 'only one account may use the system login (omit token)',
          });
        }
        tokenless = true;
      }
    });
  });
export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;

export interface LoadGlobalConfigDeps {
  homedir: () => string;
}

/** A missing file is an empty config: without accounts specrun behaves as before (MAD-6). */
export function loadGlobalConfig(deps: LoadGlobalConfigDeps): GlobalConfig {
  const path = join(deps.homedir(), GLOBAL_CONFIG_FILE);
  if (!existsSync(path)) return { accounts: [] };
  const json = readJsonFile(path);
  if (!json.ok) {
    throw new SpecrunError('config-invalid', `${GLOBAL_CONFIG_LABEL} is invalid`, [json.error]);
  }
  const parsed = GlobalConfigSchema.safeParse(json.value);
  if (!parsed.success) {
    throw new SpecrunError(
      'config-invalid',
      `${GLOBAL_CONFIG_LABEL} is invalid`,
      formatIssues(parsed.error),
    );
  }
  return parsed.data;
}
