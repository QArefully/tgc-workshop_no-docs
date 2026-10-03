import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { closeDatabase, migrateDatabase } from '../../src/db/index.js';
import { countryLocalisationMigration } from '../../src/db/migrations/032_country_localisation.js';
import { migrations } from '../../src/db/migrations/index.js';

const pre032Migrations = migrations.filter((migration) => migration.version < '032');

function openPre032Database(prefix: string): { directory: string; db: Database.Database } {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  const db = new Database(join(directory, 'shop.db'));
  db.pragma('foreign_keys = ON');
  migrateDatabase(db, pre032Migrations);
  return { directory, db };
}

function insertUser(db: Database.Database, id: number, email: string): void {
  db.prepare(
    `INSERT INTO users (id, email, display_name, password_hash, password_salt, role)
     VALUES (?, ?, 'Test user', 'hash', 'salt', 'customer')`,
  ).run(id, email);
}

function insertOrder(db: Database.Database, id: number, email: string): void {
  db.prepare(
    `INSERT INTO orders
      (id, customer_name, customer_email, shipping_address, subtotal_cents, total_cents, lifecycle_status, version)
     VALUES (?, 'Test customer', ?, '1 Test Rd', 1000, 1000, 'processing', 0)`,
  ).run(id, email);
}

function insertCart(db: Database.Database, id: string): void {
  db.prepare(`INSERT INTO carts (id) VALUES (?)`).run(id);
}

function insertCompany(db: Database.Database, name: string, createdByUserId: number): void {
  db.prepare(
    `INSERT INTO company_accounts (name, created_by_user_id, created_at, updated_at)
     VALUES (?, ?, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`,
  ).run(name, createdByUserId);
}

void test('migration 032 backfills country = UK on existing rows', () => {
  const { directory, db } = openPre032Database('shop-country-backfill-');

  try {
    insertUser(db, 3201, 'backfill-user@example.test');
    insertOrder(db, 3201, 'backfill-order@example.test');
    insertCart(db, 'backfill-cart');
    insertUser(db, 3202, 'company-owner@example.test');
    insertCompany(db, 'Backfill Co', 3202);

    const userCountBefore = (
      db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }
    ).count;
    const orderCountBefore = (
      db.prepare('SELECT COUNT(*) AS count FROM orders').get() as { count: number }
    ).count;
    const cartCountBefore = (
      db.prepare('SELECT COUNT(*) AS count FROM carts').get() as { count: number }
    ).count;
    const companyCountBefore = (
      db.prepare('SELECT COUNT(*) AS count FROM company_accounts').get() as { count: number }
    ).count;

    migrateDatabase(db);

    assert.equal(
      (db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }).count,
      userCountBefore,
    );
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS count FROM orders').get() as { count: number }).count,
      orderCountBefore,
    );
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS count FROM carts').get() as { count: number }).count,
      cartCountBefore,
    );
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS count FROM company_accounts').get() as { count: number })
        .count,
      companyCountBefore,
    );

    const userCountry = (
      db.prepare("SELECT country FROM users WHERE email = 'backfill-user@example.test'").get() as {
        country: string;
      }
    ).country;
    assert.equal(userCountry, 'UK');

    const orderCountry = (
      db
        .prepare("SELECT country FROM orders WHERE customer_email = 'backfill-order@example.test'")
        .get() as { country: string }
    ).country;
    assert.equal(orderCountry, 'UK');

    const cartCountry = (
      db.prepare("SELECT country FROM carts WHERE id = 'backfill-cart'").get() as {
        country: string;
      }
    ).country;
    assert.equal(cartCountry, 'UK');

    const companyCountry = (
      db.prepare("SELECT country FROM company_accounts WHERE name = 'Backfill Co'").get() as {
        country: string;
      }
    ).country;
    assert.equal(companyCountry, 'UK');

    assert.equal((db.pragma('foreign_key_check') as unknown[]).length, 0);
  } finally {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  }
});

void test('migration 032 enforces composite (email, country) uniqueness', () => {
  const { directory, db } = openPre032Database('shop-country-composite-');

  try {
    migrateDatabase(db);

    insertUser(db, 3211, 'composite@example.test');
    const countryAfterInsert = (
      db.prepare("SELECT country FROM users WHERE email = 'composite@example.test'").get() as {
        country: string;
      }
    ).country;
    assert.equal(countryAfterInsert, 'UK');

    assert.throws(
      () => insertUser(db, 3212, 'composite@example.test'),
      /UNIQUE constraint failed/,
      'same email + same country (UK default) must reject',
    );

    db.prepare(
      `INSERT INTO users (id, email, display_name, password_hash, password_salt, role, country)
       VALUES (3212, 'composite@example.test', 'US user', 'hash', 'salt', 'customer', 'US')`,
    ).run();

    const usCountry = (
      db.prepare('SELECT country FROM users WHERE id = 3212').get() as { country: string }
    ).country;
    assert.equal(usCountry, 'US', 'same email in a different country is allowed');

    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO users (id, email, display_name, password_hash, password_salt, role, country)
           VALUES (3213, 'composite@example.test', 'US dupe', 'hash', 'salt', 'customer', 'US')`,
          )
          .run(),
      /UNIQUE constraint failed/,
      'same email + same non-UK country must reject',
    );
  } finally {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  }
});

void test('migration 032 preserves row count through rebuild', () => {
  const { directory, db } = openPre032Database('shop-country-count-');

  try {
    const seededIds = [3261, 3262, 3263, 3264, 3265];
    for (const id of seededIds) {
      insertUser(db, id, `count-user-${id}@example.test`);
    }

    const preMigrationCount = (
      db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }
    ).count;
    assert.ok(
      preMigrationCount >= seededIds.length,
      'fixture must contain rows so the preservation assertion is not 0 === 0',
    );

    migrateDatabase(db);

    const postMigrationCount = (
      db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }
    ).count;
    assert.equal(postMigrationCount, preMigrationCount);

    // Row count alone can hide a rebuild that copied the wrong rows: pin identity too.
    const survivingIds = (
      db
        .prepare('SELECT id FROM users WHERE id IN (3261, 3262, 3263, 3264, 3265) ORDER BY id')
        .all() as { id: number }[]
    ).map((row) => row.id);
    assert.deepEqual(survivingIds, seededIds, 'every seeded user row must survive the rebuild');
  } finally {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  }
});

void test('migration 032 self-FK survives rebuild', () => {
  const { directory, db } = openPre032Database('shop-country-self-fk-');

  try {
    insertUser(db, 3221, 'admin-user@example.test');
    insertUser(db, 3222, 'target-user@example.test');

    migrateDatabase(db);

    db.prepare(
      `UPDATE users SET suspended_at = '2026-08-01T00:00:00.000Z', suspension_reason = 'test',
              suspended_by_user_id = 3221
       WHERE id = 3222`,
    ).run();

    assert.equal(
      (db.pragma('foreign_key_check') as unknown[]).length,
      0,
      'self-FK intact after rebuild',
    );

    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO users (id, email, display_name, password_hash, password_salt, role, country, suspended_by_user_id)
             VALUES (3223, 'bad-fk@example.test', 'Bad FK', 'hash', 'salt', 'customer', 'UK', 99999)`,
          )
          .run(),
      /FOREIGN KEY constraint failed/,
      'invalid suspended_by_user_id must reject',
    );
  } finally {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  }
});

void test('migration 032 is idempotent', () => {
  const { directory, db } = openPre032Database('shop-country-idempotent-');

  try {
    insertUser(db, 3231, 'idempotent@example.test');
    const preMigrationCount = (
      db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }
    ).count;

    migrateDatabase(db);
    const afterFirstCount = (
      db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }
    ).count;
    assert.equal(afterFirstCount, preMigrationCount);

    // `migrateDatabase` skips versions already recorded in `schema_migrations`, so calling it twice
    // never re-enters `up`. Invoke the migration body directly to exercise its idempotency guard.
    migrateDatabase(db);
    const afterSecondRunnerCount = (
      db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }
    ).count;
    assert.equal(afterSecondRunnerCount, preMigrationCount);

    db.transaction(() => {
      countryLocalisationMigration.up(db);
    })();

    const afterSecondCount = (
      db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }
    ).count;
    assert.equal(
      afterSecondCount,
      preMigrationCount,
      'direct replay of up() must not duplicate or drop rows',
    );

    for (const table of ['users', 'orders', 'carts', 'company_accounts']) {
      const countryColumns = (
        db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
      ).filter((column) => column.name === 'country');
      assert.equal(countryColumns.length, 1, `${table} must have exactly one country column`);
    }

    // A replay that re-ran the rebuild would have recreated users and lost the composite index.
    assert.throws(
      () => insertUser(db, 3232, 'idempotent@example.test'),
      /UNIQUE constraint failed/,
      'composite (email, country) uniqueness must survive a direct replay',
    );

    const userCountry = (
      db.prepare("SELECT country FROM users WHERE email = 'idempotent@example.test'").get() as {
        country: string;
      }
    ).country;
    assert.equal(userCountry, 'UK');

    assert.equal((db.pragma('foreign_key_check') as unknown[]).length, 0);
  } finally {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  }
});

void test('migration 032 preserves the users AUTOINCREMENT high-water mark', () => {
  const { directory, db } = openPre032Database('shop-country-sequence-');

  try {
    insertUser(db, 3271, 'sequence-keep@example.test');
    insertUser(db, 3272, 'sequence-deleted@example.test');

    // Deleting the highest id leaves MAX(id) below the sqlite_sequence ceiling. If the rebuild lost
    // that ceiling, the next insert would recycle 3272 into stale FK references.
    db.prepare('DELETE FROM users WHERE id = 3272').run();

    const sequenceBefore = (
      db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'users'").get() as
        { seq: number } | undefined
    )?.seq;
    assert.equal(sequenceBefore, 3272, 'fixture must leave the high-water mark above MAX(id)');
    assert.equal(
      (db.prepare('SELECT MAX(id) AS maxId FROM users').get() as { maxId: number }).maxId,
      3271,
    );

    migrateDatabase(db);

    const sequenceAfter = (
      db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'users'").get() as
        { seq: number } | undefined
    )?.seq;
    assert.equal(sequenceAfter, sequenceBefore, 'AUTOINCREMENT ceiling must survive the rebuild');

    db.prepare(
      `INSERT INTO users (email, display_name, password_hash, password_salt, role)
       VALUES ('sequence-next@example.test', 'Next', 'hash', 'salt', 'customer')`,
    ).run();
    const newId = (
      db.prepare("SELECT id FROM users WHERE email = 'sequence-next@example.test'").get() as {
        id: number;
      }
    ).id;
    assert.ok(newId > 3272, `new user id ${newId} must not recycle a retired id`);
  } finally {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  }
});

void test('migration 032 rejects invalid country values', () => {
  const { directory, db } = openPre032Database('shop-country-check-');

  try {
    migrateDatabase(db);

    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO users (id, email, display_name, password_hash, password_salt, role, country)
           VALUES (3241, 'bad-country@example.test', 'Bad', 'hash', 'salt', 'customer', 'XX')`,
          )
          .run(),
      /CHECK constraint failed/,
    );

    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO users (id, email, display_name, password_hash, password_salt, role, country)
           VALUES (3242, 'null-country@example.test', 'Null', 'hash', 'salt', 'customer', NULL)`,
          )
          .run(),
      /NOT NULL constraint failed/,
    );

    const validCountries: Array<{ code: string; id: number }> = [
      { code: 'UK', id: 3251 },
      { code: 'US', id: 3252 },
      { code: 'CN', id: 3253 },
      { code: 'PL', id: 3254 },
      { code: 'ES', id: 3255 },
      { code: 'DE', id: 3256 },
      { code: 'FR', id: 3257 },
    ];
    for (const { code, id } of validCountries) {
      assert.doesNotThrow(
        () =>
          db
            .prepare(
              `INSERT INTO users (id, email, display_name, password_hash, password_salt, role, country)
             VALUES (?, ?, ?, 'hash', 'salt', 'customer', ?)`,
            )
            .run(id, `${code}-valid@example.test`, `${code} user`, code),
        `${code} must be accepted`,
      );
    }
  } finally {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  }
});

void test('migration 032 adds country to orders, carts, and company_accounts', () => {
  const { directory, db } = openPre032Database('shop-country-other-tables-');

  try {
    migrateDatabase(db);

    for (const table of ['orders', 'carts', 'company_accounts']) {
      const columns = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
        (column) => column.name,
      );
      assert.ok(columns.includes('country'), `${table} must have country column`);
    }

    assert.equal((db.pragma('foreign_key_check') as unknown[]).length, 0);
  } finally {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  }
});
