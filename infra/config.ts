import { z } from 'zod';

export const VAULT_VARIABLES = [
  'PGPASSWORD',
  'JWT_PRIVATE_KEY',
  'JWT_PUBLIC_KEY',
  'JWT_KID',
  'REFRESH_TOKEN_PEPPER',
] as const;

export type VaultVariable = (typeof VAULT_VARIABLES)[number];

const VaultSchema = z.object(
  Object.fromEntries(VAULT_VARIABLES.map((name) => [name, z.string().min(1)])) as Record<VaultVariable, z.ZodString>,
);

export type VaultValues = Record<VaultVariable, string>;

export function loadVaultValues(source: NodeJS.ProcessEnv = process.env): VaultValues {
  const result = VaultSchema.safeParse(source);

  if (!result.success) {
    const missing = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];

    throw new Error(
      `Missing vault variable(s): ${missing.join(', ')}. ` +
        'They come from the vault (#11) via scripts/with-secrets.sh, or from export with SKIP_VAULT=1.',
    );
  }

  return result.data as VaultValues;
}
