import type { Migration } from '../migrate.js';

function addColumnIfMissing(
  db: Parameters<Migration['up']>[0],
  column: string,
  definition: string,
): void {
  const columns = db.prepare('PRAGMA table_info(powder_mixes)').all() as { name: string }[];
  if (!columns.some((existing) => existing.name === column)) {
    db.exec(`ALTER TABLE powder_mixes ADD COLUMN ${column} ${definition}`);
  }
}

/** Adds a durable Powderizer-only bag colour scheme to existing active mixes. */
export const powderizerExpansionMigration: Migration = {
  version: '009',
  name: 'powderizer expansion',
  up(db) {
    addColumnIfMissing(
      db,
      'bag_colour_scheme',
      "TEXT NOT NULL DEFAULT 'ultraviolet-cyan' CHECK (bag_colour_scheme IN ('ultraviolet-cyan', 'solar-flare', 'deep-space', 'acid-lilac', 'monochrome-glitch'))",
    );
  },
};
