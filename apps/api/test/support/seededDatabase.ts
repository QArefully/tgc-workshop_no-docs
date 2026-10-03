import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import type { TestContext } from 'node:test';
import type Database from 'better-sqlite3';
import { buildApp, type AppDependencies } from '../../src/app.js';
import { closeDatabase, openDatabase, seedDatabase } from '../../src/db/index.js';

/** Environment variable set by the integration runner for its closed seeded template. */
export const SEEDED_DATABASE_TEMPLATE_ENV = 'SHOP_TEST_TEMPLATE_PATH';

const FALLBACK_TEMPLATE_PREFIX = 'shop-api-test-template-';
const CLONE_PREFIX = 'shop-api-test-clone-';
const TEMPLATE_FILENAME = 'template.db';

interface TemplateState {
  path: string;
  directory: string;
  owned: boolean;
}

let fallbackTemplate: TemplateState | undefined;

function assertForeignKeys(db: Database.Database): void {
  const violations = db.pragma('foreign_key_check') as unknown[];
  assert.deepEqual(violations, [], 'seeded test fixture must have no foreign-key violations');
}

function checkpointAndClose(db: Database.Database): void {
  // better-sqlite3 exposes WAL checkpoint as a pragma and returns one row. TRUNCATE removes the
  // sidecar so the template can be copied as a single closed SQLite file.
  db.pragma('wal_checkpoint(TRUNCATE)');
  closeDatabase(db);
}

function removeOwnedDirectory(directory: string): void {
  rmSync(resolve(directory), { recursive: true, force: true });
}

function createProcessLocalTemplate(): TemplateState {
  const directory = mkdtempSync(join(tmpdir(), FALLBACK_TEMPLATE_PREFIX));
  const path = join(directory, TEMPLATE_FILENAME);
  let db: Database.Database | undefined;
  try {
    db = openDatabase({ path });
    seedDatabase(db);
    assertForeignKeys(db);
    checkpointAndClose(db);
    return { path, directory, owned: true };
  } catch (error) {
    if (db?.open) {
      try {
        closeDatabase(db);
      } catch {
        // Preserve the original migration/seed error; cleanup below is best effort.
      }
    }
    removeOwnedDirectory(directory);
    throw error;
  }
}

function resolveTemplate(): TemplateState {
  const configured = process.env[SEEDED_DATABASE_TEMPLATE_ENV];
  if (configured !== undefined && configured.trim() !== '') {
    const path = resolve(configured.trim());
    if (!isAbsolute(configured.trim()) || !existsSync(path)) {
      throw new Error(`${SEEDED_DATABASE_TEMPLATE_ENV} must point to an existing SQLite file`);
    }
    return { path, directory: dirname(path), owned: false };
  }

  if (fallbackTemplate === undefined) {
    fallbackTemplate = createProcessLocalTemplate();
  }
  return fallbackTemplate;
}

function cleanupFallbackTemplate(): void {
  const template = fallbackTemplate;
  fallbackTemplate = undefined;
  if (template?.owned) removeOwnedDirectory(template.directory);
}

// The fallback is process-local and never exposed to production composition. Use a synchronous
// exit hook so direct focused `tsx --test` runs leave no generated SQLite files behind.
process.once('exit', cleanupFallbackTemplate);

export interface SeededDatabaseFixture {
  /** Exact owned directory containing this fixture's database and SQLite sidecars. */
  readonly directory: string;
  /** Exact writable SQLite path for this fixture. */
  readonly databasePath: string;
  /** Production database connection opened after cloning the closed template. */
  readonly db: Database.Database;
  /** Idempotently close the database and remove only this fixture's directory. */
  readonly cleanup: () => void | Promise<void>;
  /** Alias for cleanup, useful in `finally` blocks. */
  readonly close: () => void | Promise<void>;
}

export interface SeededAppFixture extends SeededDatabaseFixture {
  readonly app: Awaited<ReturnType<typeof buildApp>>;
  /** Close Fastify before closing SQLite and removing the owned directory. */
  readonly cleanup: () => Promise<void>;
  /** Alias for cleanup, useful in `finally` blocks. */
  readonly close: () => Promise<void>;
}

/**
 * Clone the runner template (or build one lazily for a focused direct run) and open it through
 * the production database lifecycle. The source template is always closed before copying.
 */
export function openSeededDatabase(testContext?: TestContext): SeededDatabaseFixture {
  const template = resolveTemplate();
  const directory = mkdtempSync(join(tmpdir(), CLONE_PREFIX));
  const databasePath = join(directory, basename(template.path));
  let db: Database.Database | undefined;
  let cleaned = false;

  try {
    copyFileSync(template.path, databasePath);
    db = openDatabase({ path: databasePath });
    assertForeignKeys(db);
  } catch (error) {
    if (db?.open) {
      try {
        closeDatabase(db);
      } catch {
        // Preserve the original clone/open error; exact owned directory is still removed.
      }
    }
    removeOwnedDirectory(directory);
    throw error;
  }

  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    try {
      if (db?.open) closeDatabase(db);
    } finally {
      removeOwnedDirectory(directory);
    }
  };

  const fixture = {
    directory,
    databasePath,
    db,
    cleanup,
    close: cleanup,
  };
  if (testContext !== undefined) testContext.after(cleanup);
  return fixture;
}

/** Backwards-readable alias for callers migrating a single DB fixture at a time. */
export const createSeededDatabaseFixture = openSeededDatabase;
/** Alias used by route tests that call their DB fixture an opened fixture. */
export const openSeededFixture = openSeededDatabase;

/** Test-only inspection hook; callers must not mutate the returned closed template. */
export function getSeededTemplatePath(): string {
  return resolveTemplate().path;
}

export interface SeededAppFixtureOptions {
  /** Optional node:test context; cleanup is registered only after app construction succeeds. */
  readonly testContext?: TestContext;
  /** Fastify dependencies other than the fixture-owned database. */
  readonly app?: Omit<AppDependencies, 'db'>;
}

/**
 * Build one Fastify instance over one writable seeded clone. App teardown always precedes DB
 * teardown, and failed app construction removes the already-open clone immediately.
 */
export async function createSeededAppFixture(
  optionsOrContext: SeededAppFixtureOptions | TestContext = {},
): Promise<SeededAppFixture> {
  const options: SeededAppFixtureOptions =
    'after' in optionsOrContext ? { testContext: optionsOrContext } : optionsOrContext;
  const database = openSeededDatabase();
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    app = await buildApp({
      db: database.db,
      resetBaseUrl: 'http://web.test',
      ...options.app,
    });
  } catch (error) {
    await database.cleanup();
    throw error;
  }

  let cleaned = false;
  const cleanup = async (): Promise<void> => {
    if (cleaned) return;
    cleaned = true;
    try {
      await app.close();
    } finally {
      await database.cleanup();
    }
  };

  const fixture: SeededAppFixture = {
    ...database,
    app,
    cleanup,
    close: cleanup,
  };
  if (options.testContext !== undefined) options.testContext.after(cleanup);
  return fixture;
}

/** Alias for route tests that refer to the complete DB + Fastify fixture as one fixture. */
export const createSeededFixture = createSeededAppFixture;

/** Dispose a lazily-created direct-run template in explicit test harnesses. */
export function cleanupSeededTemplate(): void {
  cleanupFallbackTemplate();
}
