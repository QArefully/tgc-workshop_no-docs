import type { Migration } from '../migrate.js';

function addColumnIfMissing(
  db: Parameters<Migration['up']>[0],
  column: string,
  definition: string,
): void {
  const columns = db.prepare('PRAGMA table_info(payments)').all() as { name: string }[];
  if (!columns.some((existing) => existing.name === column)) {
    db.exec(`ALTER TABLE payments ADD COLUMN ${column} ${definition}`);
  }
}

/** Adds checkout-intent storage without rewriting existing replayable payment rows. */
export const checkoutIntentsMigration: Migration = {
  version: '007',
  name: 'checkout intents and reservations',
  up(db) {
    addColumnIfMissing(db, 'cart_id', 'TEXT');
    addColumnIfMissing(db, 'quote_json', 'TEXT');
    addColumnIfMissing(db, 'gateway_reference', 'TEXT');
    addColumnIfMissing(db, 'updated_at', 'TEXT');
    db.exec(`
      UPDATE payments SET updated_at = created_at WHERE updated_at IS NULL;

      CREATE TABLE IF NOT EXISTS cart_reservations (
        cart_id TEXT PRIMARY KEY,
        payment_idempotency_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE CASCADE,
        FOREIGN KEY (payment_idempotency_key) REFERENCES payments(idempotency_key)
      );

      CREATE TABLE IF NOT EXISTS promo_reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        promo_code TEXT NOT NULL,
        user_id INTEGER,
        payment_idempotency_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        FOREIGN KEY (promo_code) REFERENCES promo_codes(code),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (payment_idempotency_key) REFERENCES payments(idempotency_key)
      );

      CREATE INDEX IF NOT EXISTS payments_status_idx ON payments(status);
      CREATE INDEX IF NOT EXISTS cart_reservations_payment_idx
        ON cart_reservations(payment_idempotency_key);
      CREATE INDEX IF NOT EXISTS promo_reservations_code_idx ON promo_reservations(promo_code);
      CREATE INDEX IF NOT EXISTS promo_reservations_user_idx
        ON promo_reservations(promo_code, user_id);
    `);
  },
};
