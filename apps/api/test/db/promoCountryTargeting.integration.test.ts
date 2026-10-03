import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { closeDatabase, migrateDatabase } from '../../src/db/index.js';
import { promoCountryTargetingMigration } from '../../src/db/migrations/033_promo_country_targeting.js';
import { migrations } from '../../src/db/migrations/index.js';

void test('migration 033 adds idempotent promo country targeting with cascading cleanup', () => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-promo-country-targeting-'));
  const db = new Database(join(directory, 'shop.db'));
  db.pragma('foreign_keys = ON');

  try {
    migrateDatabase(db);

    assert.equal(migrations.at(-1)?.version, '038');
    assert.equal(
      (
        db.prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1').get() as {
          version: string;
        }
      ).version,
      '038',
    );

    const columns = (
      db.prepare('PRAGMA table_info(promo_code_countries)').all() as Array<{
        name: string;
        type: string;
        notnull: number;
        pk: number;
      }>
    ).map(({ name, type, notnull, pk }) => ({ name, type, notnull, pk }));
    assert.deepEqual(columns, [
      { name: 'promo_code_id', type: 'INTEGER', notnull: 1, pk: 1 },
      { name: 'country', type: 'TEXT', notnull: 1, pk: 2 },
    ]);

    assert.deepEqual(
      (
        db.prepare('PRAGMA foreign_key_list(promo_code_countries)').all() as Array<{
          table: string;
          from: string;
          to: string;
          on_delete: string;
        }>
      ).map(({ table, from, to, on_delete }) => ({ table, from, to, on_delete })),
      [{ table: 'promo_codes', from: 'promo_code_id', to: 'id', on_delete: 'CASCADE' }],
    );
    assert.ok(
      (db.prepare('PRAGMA index_list(promo_code_countries)').all() as { name: string }[]).some(
        (index) => index.name === 'promo_code_countries_country_idx',
      ),
    );

    const promoId = Number(
      db
        .prepare(
          `INSERT INTO promo_codes (code, discount_percent, min_item_count, active)
           VALUES ('P33-COUNTRY-TARGET', 10, 0, 1)`,
        )
        .run().lastInsertRowid,
    );
    assert.equal(
      (
        db
          .prepare('SELECT COUNT(*) AS count FROM promo_code_countries WHERE promo_code_id = ?')
          .get(promoId) as { count: number }
      ).count,
      0,
      'absence of targeting rows represents an all-country promo',
    );

    const insertCountry = db.prepare(
      'INSERT INTO promo_code_countries (promo_code_id, country) VALUES (?, ?)',
    );
    for (const country of ['UK', 'US', 'CN', 'PL', 'ES', 'DE', 'FR']) {
      assert.doesNotThrow(() => insertCountry.run(promoId, country), `${country} must be accepted`);
    }
    assert.throws(() => insertCountry.run(promoId, 'XX'), /CHECK constraint failed/);

    const migrationCountAfterFirstRun = (
      db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as { count: number }
    ).count;
    migrateDatabase(db);
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as { count: number })
        .count,
      migrationCountAfterFirstRun,
    );
    assert.doesNotThrow(() => promoCountryTargetingMigration.up(db));
    assert.equal(
      (
        db
          .prepare('SELECT COUNT(*) AS count FROM promo_code_countries WHERE promo_code_id = ?')
          .get(promoId) as { count: number }
      ).count,
      7,
    );

    db.prepare('DELETE FROM promo_codes WHERE id = ?').run(promoId);
    assert.equal(
      (
        db
          .prepare('SELECT COUNT(*) AS count FROM promo_code_countries WHERE promo_code_id = ?')
          .get(promoId) as { count: number }
      ).count,
      0,
    );
    assert.equal((db.pragma('foreign_key_check') as unknown[]).length, 0);
  } finally {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  }
});
