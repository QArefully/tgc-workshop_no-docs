import type { Migration } from '../migrate.js';

type MigrationDb = Parameters<Migration['up']>[0];

function assertForeignKeysClean(db: MigrationDb): void {
  const violations = db.pragma('foreign_key_check') as unknown[];
  if (violations.length > 0) {
    throw new Error(`Foreign key violations after migration 033: ${JSON.stringify(violations)}`);
  }
}

/** Adds optional country targeting for promo codes; no rows means the promo applies globally. */
export const promoCountryTargetingMigration: Migration = {
  version: '033',
  name: 'promo country targeting',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS promo_code_countries (
        promo_code_id INTEGER NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
        country TEXT NOT NULL CHECK (country IN ('UK','US','CN','PL','ES','DE','FR')),
        PRIMARY KEY (promo_code_id, country)
      );

      CREATE INDEX IF NOT EXISTS promo_code_countries_country_idx
        ON promo_code_countries(country);
    `);

    assertForeignKeysClean(db);
  },
};
