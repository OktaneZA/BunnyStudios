import { z } from 'zod';
import { loadEnvFile } from 'node:process';

// Resolve from this module so both workspace scripts and direct launches load the same file.
// Existing environment variables (including Azure secrets) take precedence.
try { loadEnvFile(new URL('../.env', import.meta.url)); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }

/**
 * All configuration arrives as environment variables. In Azure these are Container Apps
 * secrets backed by Key Vault (NF-20) — nothing secret is ever committed or bundled.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default('0.0.0.0'),

  DATABASE_URL: z.string().min(1),

  /** Signs session tokens. Must be a real random value in production. */
  JWT_SECRET: z.string().min(32),

  /**
   * Plan D8 — v1 has exactly two hardcoded accounts, an adult and a teenager.
   * Passwords are supplied as scrypt hashes (see auth.ts hashPassword), never plaintext.
   * This whole block disappears when real auth lands; nothing else depends on it.
   */
  AUTH_ADULT_EMAIL: z.string().email(),
  AUTH_ADULT_PASSWORD_HASH: z.string().min(1),
  AUTH_ADULT_DISPLAY_NAME: z.string().default('Adult'),
  AUTH_TEEN_EMAIL: z.string().email(),
  AUTH_TEEN_PASSWORD_HASH: z.string().min(1),
  AUTH_TEEN_DISPLAY_NAME: z.string().default('Creator'),

  /** Comma-separated list of allowed browser origins. */
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  /**
   * Absolute path to the built web app (apps/web/dist). When set, the API serves it from
   * the same origin so a single container is the whole deployment (Synology / Docker).
   * Unset in development, where Vite serves the web app and proxies /api.
   */
  WEB_ROOT: z.string().trim().default(''),
  /**
   * Version identity, stamped into the image by deploy/release.mjs and reported by /health.
   * APP_VERSION is the root package.json version (the human one); GIT_COMMIT pins the source;
   * BUILD_TAG is the image tag, `v<version>-<commit>`, which is what a rollback names.
   */
  APP_VERSION: z.string().trim().default('0.0.0-dev'),
  GIT_COMMIT: z.string().trim().default('unknown'),
  BUILD_TAG: z.string().trim().default('dev'),
  ANTHROPIC_API_KEY: z.string().trim().default(''),
  ANTHROPIC_MODEL: z.string().trim().min(1).default('claude-sonnet-5'),
  THUMBNAIL_DAILY_LIMIT: z.coerce.number().int().min(1).max(500).default(30),
  THUMBNAIL_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).max(20).default(3),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const config = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  isProduction: parsed.data.NODE_ENV === 'production',
} as const;

export type Config = typeof config;
