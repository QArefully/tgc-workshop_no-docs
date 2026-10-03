import type Database from 'better-sqlite3';

/** Owns synchronous SQLite transaction boundaries for workflow services. */
export interface UnitOfWork {
  run<T>(work: () => T): T;
}

export function createUnitOfWork(db: Database.Database): UnitOfWork {
  return { run: <T>(work: () => T): T => db.transaction(work)() };
}
