import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db, sql } from './client.ts';

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');

await migrate(db, { migrationsFolder });
console.log('migrations applied');
await sql.end();
