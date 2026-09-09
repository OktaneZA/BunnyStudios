import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://storyboard:localdev@localhost:5433/storyboard',
  },
  strict: true,
  verbose: true,
} satisfies Config;
