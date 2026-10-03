import type { Migration } from '../migrate.js';

export const orderUserMigration: Migration = {
  version: '004',
  name: 'order user ownership',
  up(db) {
    const columns = db.prepare('PRAGMA table_info(orders)').all() as { name: string }[];
    if (!columns.some((existing) => existing.name === 'user_id')) {
      db.exec('ALTER TABLE orders ADD COLUMN user_id INTEGER');
    }
  },
};
