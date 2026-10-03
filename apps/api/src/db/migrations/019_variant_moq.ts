import type { Migration } from '../migrate.js';

function hasColumn(db: Parameters<Migration['up']>[0], table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some((existing) => existing.name === column);
}

/** Adds sack minimum-order quantities to purchasable product variants. */
export const variantMoqMigration: Migration = {
  version: '019',
  name: 'variant minimum order quantities',
  up(db) {
    if (!hasColumn(db, 'product_variants', 'moq_sacks')) {
      db.exec('ALTER TABLE product_variants ADD COLUMN moq_sacks INTEGER NOT NULL DEFAULT 4');
    }

    const invalidMoqs = (
      db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM product_variants
           WHERE moq_sacks IS NULL OR typeof(moq_sacks) <> 'integer'`,
        )
        .get() as { count: number }
    ).count;
    if (invalidMoqs > 0) {
      throw new Error(`${invalidMoqs} product variants have invalid moq_sacks`);
    }

    const fkViolations = db.pragma('foreign_key_check') as unknown[];
    if (fkViolations && fkViolations.length > 0) {
      throw new Error(
        `Foreign key violations after v19 migration: ${JSON.stringify(fkViolations)}`,
      );
    }
  },
};
