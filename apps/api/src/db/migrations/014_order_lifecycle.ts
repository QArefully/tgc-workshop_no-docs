import type { Migration } from '../migrate.js';

function addOrderColumnIfMissing(
  db: Parameters<Migration['up']>[0],
  column: string,
  definition: string,
): void {
  const columns = db.prepare('PRAGMA table_info(orders)').all() as { name: string }[];
  if (!columns.some((existing) => existing.name === column)) {
    db.exec(`ALTER TABLE orders ADD COLUMN ${column} ${definition}`);
  }
}

/** Adds persisted order-lifecycle state without rewriting purchased snapshots. */
export const orderLifecycleMigration: Migration = {
  version: '014',
  name: 'order lifecycle',
  up(db) {
    addOrderColumnIfMissing(
      db,
      'lifecycle_status',
      "TEXT NOT NULL DEFAULT 'processing' CHECK (lifecycle_status IN ('processing', 'packed', 'shipped', 'delivered', 'delivery_failed', 'cancelled'))",
    );
    addOrderColumnIfMissing(
      db,
      'version',
      "INTEGER NOT NULL DEFAULT 0 CHECK (typeof(version) = 'integer' AND version >= 0)",
    );
    addOrderColumnIfMissing(db, 'cancelled_at', 'TEXT');
    addOrderColumnIfMissing(db, 'demo_seed_key', 'TEXT');

    db.exec(`
      CREATE TABLE IF NOT EXISTS order_shipments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        shipment_number INTEGER NOT NULL CHECK (typeof(shipment_number) = 'integer' AND shipment_number > 0),
        status TEXT NOT NULL CHECK (status IN ('packed', 'shipped', 'delivered', 'delivery_failed', 'cancelled')),
        tracking_reference TEXT CHECK (tracking_reference IS NULL OR length(tracking_reference) BETWEEN 1 AND 100),
        version INTEGER NOT NULL DEFAULT 0 CHECK (typeof(version) = 'integer' AND version >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (order_id, shipment_number),
        UNIQUE (order_id, tracking_reference)
      );

      CREATE TABLE IF NOT EXISTS order_shipment_items (
        shipment_id INTEGER NOT NULL REFERENCES order_shipments(id) ON DELETE CASCADE,
        order_line_item_id INTEGER REFERENCES order_line_items(id) ON DELETE CASCADE,
        order_powder_mix_item_id INTEGER REFERENCES order_powder_mix_items(id) ON DELETE CASCADE,
        quantity INTEGER NOT NULL CHECK (typeof(quantity) = 'integer' AND quantity > 0),
        CHECK (
          (order_line_item_id IS NOT NULL AND order_powder_mix_item_id IS NULL)
          OR (order_line_item_id IS NULL AND order_powder_mix_item_id IS NOT NULL)
        ),
        UNIQUE (shipment_id, order_line_item_id),
        UNIQUE (shipment_id, order_powder_mix_item_id)
      );

      CREATE TABLE IF NOT EXISTS order_lifecycle_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        shipment_id INTEGER REFERENCES order_shipments(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL CHECK (event_type IN (
          'order_created',
          'shipment_packed',
          'shipment_shipped',
          'shipment_delivered',
          'shipment_delivery_failed',
          'shipment_tracking_updated',
          'order_cancelled'
        )),
        tracking_code TEXT CHECK (tracking_code IS NULL OR tracking_code IN (
          'in_transit',
          'out_for_delivery',
          'delivery_attempted',
          'delivered'
        )),
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
        detail TEXT CHECK (detail IS NULL OR length(detail) BETWEEN 1 AND 2000),
        location TEXT CHECK (location IS NULL OR length(location) BETWEEN 1 AND 160),
        idempotency_key TEXT,
        request_fingerprint TEXT,
        occurred_at TEXT NOT NULL,
        CHECK (
          (idempotency_key IS NULL AND request_fingerprint IS NULL)
          OR (idempotency_key IS NOT NULL AND request_fingerprint IS NOT NULL)
        ),
        UNIQUE (idempotency_key)
      );

      CREATE TABLE IF NOT EXISTS order_access_grants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
        token_digest TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS orders_demo_seed_key_idx
        ON orders(demo_seed_key) WHERE demo_seed_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS orders_user_created_at_id_idx
        ON orders(user_id, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS order_shipments_order_number_idx
        ON order_shipments(order_id, shipment_number);
      CREATE INDEX IF NOT EXISTS order_shipment_items_order_line_item_idx
        ON order_shipment_items(order_line_item_id);
      CREATE INDEX IF NOT EXISTS order_shipment_items_order_mix_item_idx
        ON order_shipment_items(order_powder_mix_item_id);
      CREATE INDEX IF NOT EXISTS order_lifecycle_events_order_occurred_id_idx
        ON order_lifecycle_events(order_id, occurred_at, id);
      CREATE INDEX IF NOT EXISTS order_lifecycle_events_shipment_occurred_id_idx
        ON order_lifecycle_events(shipment_id, occurred_at, id);
      CREATE INDEX IF NOT EXISTS order_access_grants_expires_at_idx
        ON order_access_grants(expires_at);
      CREATE INDEX IF NOT EXISTS order_access_grants_order_id_idx
        ON order_access_grants(order_id);

      CREATE TRIGGER IF NOT EXISTS order_lifecycle_events_no_update
      BEFORE UPDATE ON order_lifecycle_events
      BEGIN
        SELECT RAISE(ABORT, 'order_lifecycle_events are immutable');
      END;
    `);

    db.prepare(
      `INSERT INTO order_lifecycle_events (order_id, event_type, title, occurred_at)
       SELECT orders.id, 'order_created', 'Order created', orders.created_at
       FROM orders
       WHERE NOT EXISTS (
         SELECT 1 FROM order_lifecycle_events
         WHERE order_lifecycle_events.order_id = orders.id
           AND order_lifecycle_events.event_type = 'order_created'
       )`,
    ).run();
  },
};
