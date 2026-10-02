import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client.ts';
import { verifyPassword } from '../auth.ts';
import { ApiError } from '../errors.ts';

const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/login', async (request) => {
    const { email, password } = loginBody.parse(request.body);

    const [account] = await db
      .select()
      .from(schema.accounts)
      .where(and(eq(schema.accounts.email, email.toLowerCase()), isNull(schema.accounts.deletedAt)))
      .limit(1);

    // Verify against a dummy hash even when the account is missing, so response timing
    // does not reveal which emails exist.
    const hash = account?.passwordHash ?? 'scrypt$00$00';
    const ok = await verifyPassword(password, hash);

    if (!account || !ok) {
      throw ApiError.unauthorized('Email or password is incorrect.');
    }

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
      .where(eq(schema.accounts.id, request.accountId))
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
