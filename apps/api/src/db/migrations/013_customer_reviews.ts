import type { Migration } from '../migrate.js';

/** Adds constrained customer reviews plus paid-purchase evidence indexes. */
export const customerReviewsMigration: Migration = {
  version: '013',
  name: 'customer reviews',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        rating INTEGER NOT NULL CHECK (typeof(rating) = 'integer' AND rating BETWEEN 1 AND 5),
        body TEXT NOT NULL CHECK (body = trim(body) AND length(body) BETWEEN 20 AND 4000),
        status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'hidden')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (product_id) REFERENCES products(id),
        FOREIGN KEY (user_id) REFERENCES users(id),
        UNIQUE (user_id, product_id)
      );

      CREATE INDEX IF NOT EXISTS reviews_product_status_created_at_id_idx
        ON reviews(product_id, status, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS orders_user_id_id_idx ON orders(user_id, id);
      CREATE INDEX IF NOT EXISTS order_line_items_product_id_order_id_idx
        ON order_line_items(product_id, order_id);
      CREATE INDEX IF NOT EXISTS payments_order_id_status_idx ON payments(order_id, status);
    `);
  },
};
