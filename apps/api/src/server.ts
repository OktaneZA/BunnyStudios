import { buildApp } from './app.ts';
import { config } from './config.ts';
import { seed } from './db/seed.ts';

const app = await buildApp();

// Plan D8: the two v1 accounts are configuration, so they are reconciled at boot.
// This call disappears with the hardcoded-auth phase.
await seed();

try {
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.close().then(() => process.exit(0));
  });
}
