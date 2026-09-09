import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { config } from '../config.ts';
import * as schema from './schema.ts';

export const sql = postgres(config.DATABASE_URL, {
  max: config.isProduction ? 10 : 4,
  onnotice: () => {},
});

export const db = drizzle(sql, { schema });

export type Db = typeof db;
export { schema };
