import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { migrateDatabase } from './migrate.js';

export interface OpenDatabaseOptions {
  path: string;
}

/** Open one SQLite connection and migrate it to the current schema. */
export function openDatabase({ path: databasePath }: OpenDatabaseOptions): Database.Database {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrateDatabase(db);
  return db;
}

/** Close an application-owned SQLite connection. */
export function closeDatabase(db: Database.Database): void {
  db.close();
}
