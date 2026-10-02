import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client.ts';
import { hashPassword, verifyPassword } from '../auth.ts';
import { randomBytes } from 'node:crypto';
import { ApiError, ProblemType } from '../errors.ts';

const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/** A real scrypt hash of a random password, so an unknown email costs the same time as a wrong password. */
const DUMMY_HASH = await hashPassword(randomBytes(16).toString('hex'));

const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 60_000;
/** Wrong sign-in attempts per address. In memory: a restart forgets them, which is fine for a NAS. */
const failures = new Map<string, number[]>();

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/login', async (request, reply) => {
    const { email, password } = loginBody.parse(request.body);
    // Ten wrong guesses a minute per address: enough for a mistyped password, not for guessing one.
    // Successful sign-ins never count, so a household signing in and out is never locked out.
    const recent = failures.get(request.ip)?.filter((at) => at > Date.now() - FAILURE_WINDOW_MS) ?? [];
    if (recent.length >= MAX_FAILURES) {
      reply.header('Retry-After', '60');
      throw new ApiError(429, ProblemType.rateLimited, 'Too many tries', 'Too many wrong tries. Wait a minute, then try again.');
    }

    const [account] = await db
      .select()
      .from(schema.accounts)
      .where(and(eq(schema.accounts.email, email.toLowerCase()), isNull(schema.accounts.deletedAt)))
      .limit(1);

    // Verify against a dummy hash even when the account is missing, so response timing
    // does not reveal which emails exist.
    const hash = account?.passwordHash ?? DUMMY_HASH;
    const ok = await verifyPassword(password, hash);

    if (!account || !ok) {
      failures.set(request.ip, [...recent, Date.now()]);
      throw ApiError.unauthorized('Email or password is incorrect.');
    }
    failures.delete(request.ip);

    await db
      .update(schema.accounts)
      .set({ lastLoginAt: new Date() })
      .where(eq(schema.accounts.id, account.id));

    const token = app.jwt.sign({ sub: account.id }, { expiresIn: '30d' });

    return {
      token,
      account: {
        id: account.id,
        email: account.email,
        display_name: account.displayName,
        default_editor_mode: account.defaultEditorMode,
        is_minor: account.isMinor,
      },
    };
  });

  app.get('/me', { onRequest: [app.requireAuth] }, async (request) => {
    const [account] = await db
      .select()
      .from(schema.accounts)
      .where(and(eq(schema.accounts.id, request.accountId), isNull(schema.accounts.deletedAt)))
      .limit(1);

    if (!account) throw ApiError.unauthorized('Account no longer exists.');

    return {
      id: account.id,
      email: account.email,
      display_name: account.displayName,
      default_editor_mode: account.defaultEditorMode,
      is_minor: account.isMinor,
    };
  });
}
