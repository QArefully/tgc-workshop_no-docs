import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { closeDatabase, openDatabase, seedDatabase } from './db/index.js';

/** Start the API runtime. Database seeding remains opt-in through SHOP_SEED=true. */
export async function startServer(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase({ path: config.databasePath });
  if (config.seed) seedDatabase(db);

  const app = await buildApp({
    db,
    resetBaseUrl: config.resetBaseUrl,
    webhookSecret: config.webhookSecret,
  });
  const close = async () => {
    app.context.services.jobRunner.stop();
    await app.close();
    closeDatabase(db);
  };

  process.once('SIGINT', () => void close());
  process.once('SIGTERM', () => void close());

  try {
    app.context.services.jobRunner.start();
    await app.listen({ port: config.port, host: config.host });
    app.log.info(`API server listening on http://${config.host}:${config.port}`);
  } catch (error) {
    await close();
    throw error;
  }
}
