import { startServer } from './server.js';

export type ServerStarter = () => Promise<void>;

/** Invoke the application lifecycle from the executable entry module. */
export function runServer(start: ServerStarter = startServer): void {
  void start().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
