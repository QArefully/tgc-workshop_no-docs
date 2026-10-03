import type { Migration } from '../migrate.js';

export const paymentReplayResponseMigration: Migration = {
  version: '005',
  name: 'payment replay response',
  up(db) {
    const columns = db.prepare('PRAGMA table_info(payments)').all() as { name: string }[];
    if (!columns.some((column) => column.name === 'response_json')) {
      db.exec('ALTER TABLE payments ADD COLUMN response_json TEXT');
    }
  },
};
