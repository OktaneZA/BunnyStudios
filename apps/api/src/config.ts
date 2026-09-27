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

  // ── Director Mode (docs/director-mode-plan-v1.md) ─────────────────────────
  /** fal.ai key (plan D28). Blank disables every fal model; the picker hides them. */
  FAL_KEY: z.string().trim().default(''),
  /** Where generated pictures, clips and renders live (plan D29). A NAS volume in production. */
  STORAGE_ROOT: z.string().trim().default('./storage'),
  /** ffmpeg / ffprobe binaries for posters and the final render (plan D36). */
  FFMPEG_PATH: z.string().trim().default('ffmpeg'),
  FFPROBE_PATH: z.string().trim().default('ffprobe'),
  /** The in-process job runner (plan D30). Off in tests, which drive the runner by hand. */
  GENERATION_RUNNER: z.enum(['on', 'off']).default('on'),
  /** Development only: 'on' swaps every provider and the reviewer for fakes so the whole flow can be driven without keys. Refused in production. */
  GENERATION_FAKE: z.enum(['on', 'off']).default('off'),
  GENERATION_POLL_MS: z.coerce.number().int().min(250).max(60_000).default(3000),
  /**
   * How long a claim may be silent before a runner takes the job over. A running job heartbeats
   * every 10 seconds, so a silent claim means the process died (a restart, a crash). Short, so a
   * restart mid-clip costs a minute, not a quarter of an hour.
   */
  GENERATION_CLAIM_TIMEOUT_MS: z.coerce.number().int().min(10_000).default(60_000),
  /** How long one clip or picture may take at the provider before we give up on it. */
  GENERATION_JOB_TIMEOUT_MS: z.coerce.number().int().min(30_000).default(20 * 60_000),
  /** Where the runner's step log is written, one line per step ('' turns the file off). */
  GENERATION_LOG_FILE: z.string().trim().default('./logs/generation.log'),
  /** Claude model used to review prompts and returned pictures (plan D32 gates 1 and 3). */
  REVIEW_MODEL: z.string().trim().min(1).default('claude-sonnet-5'),
  /** Claude model used to find the cast in the story (plan D39). */
  CAST_MODEL: z.string().trim().min(1).default('claude-sonnet-5'),
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
