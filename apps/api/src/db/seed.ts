/**
 * Seeds the two v1 accounts from configuration (plan D8).
 *
 * Idempotent: re-running updates the display name, password hash and minor flag but never
 * touches the account id, so projects stay attached across redeploys.
 *
 * When real auth lands this file is deleted, not extended.
 */
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { config } from '../config.ts';
import { db, sql, schema } from './client.ts';

const seedAccounts = [
  {
    email: config.AUTH_ADULT_EMAIL,
    displayName: config.AUTH_ADULT_DISPLAY_NAME,
    passwordHash: config.AUTH_ADULT_PASSWORD_HASH,
    defaultEditorMode: 'advanced' as const,
    isMinor: false,
  },
  {
    email: config.AUTH_TEEN_EMAIL,
    displayName: config.AUTH_TEEN_DISPLAY_NAME,
    passwordHash: config.AUTH_TEEN_PASSWORD_HASH,
    // Simple mode is the designed-for experience (plan D13), so it is the default here.
    defaultEditorMode: 'simple' as const,
    // Plan D16 — drives the always-on AI content policy, independent of target_audience.
    isMinor: true,
  },
];

export async function seed(): Promise<void> {
  for (const account of seedAccounts) {
    const existing = await db
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(eq(schema.accounts.email, account.email))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(schema.accounts)
        .set({
          displayName: account.displayName,
          passwordHash: account.passwordHash,
          defaultEditorMode: account.defaultEditorMode,
          isMinor: account.isMinor,
        })
        .where(eq(schema.accounts.email, account.email));
      console.log(`seed: updated ${account.email}`);
    } else {
      await db.insert(schema.accounts).values(account);
      console.log(`seed: created ${account.email}`);
    }
  }
}

// Only run standalone when invoked directly, not when imported by the server.
// Only run standalone when invoked directly, not when imported by the server.
if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  await seed();
  await sql.end();
}
