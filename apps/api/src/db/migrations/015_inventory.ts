import type { Migration } from '../migrate.js';

function addColumnIfMissing(
  db: Parameters<Migration['up']>[0],
  table: string,
  column: string,
  definition: string,
): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((existing) => existing.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function hasTable(db: Parameters<Migration['up']>[0], table: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
  );
}

/** Establishes single inventory authority while preserving checkout and order history. */
export const inventoryMigration: Migration = {
  version: '015',
  name: 'inventory reservations, allocations, and receipts',
  up(db) {
    addColumnIfMissing(
      db,
      'products',
      'backorderable',
      'INTEGER NOT NULL DEFAULT 0 CHECK (backorderable IN (0, 1))',
    );
    addColumnIfMissing(db, 'products', 'backorder_lead_days', 'INTEGER');
    addColumnIfMissing(db, 'payments', 'reservation_expires_at', 'TEXT');

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS products_stock_count_insert_valid
      BEFORE INSERT ON products
      WHEN typeof(NEW.stock_count) <> 'integer' OR NEW.stock_count < 0
      BEGIN SELECT RAISE(ABORT, 'products.stock_count must be a nonnegative integer'); END;

      CREATE TRIGGER IF NOT EXISTS products_stock_count_update_valid
      BEFORE UPDATE OF stock_count ON products
      WHEN typeof(NEW.stock_count) <> 'integer' OR NEW.stock_count < 0
      BEGIN SELECT RAISE(ABORT, 'products.stock_count must be a nonnegative integer'); END;

      CREATE TRIGGER IF NOT EXISTS products_backorder_insert_valid
      BEFORE INSERT ON products
      WHEN NEW.backorderable NOT IN (0, 1)
        OR (NEW.backorderable = 0 AND NEW.backorder_lead_days IS NOT NULL)
        OR (NEW.backorderable = 1 AND (
          typeof(NEW.backorder_lead_days) <> 'integer'
          OR NEW.backorder_lead_days < 1 OR NEW.backorder_lead_days > 365
        ))
      BEGIN SELECT RAISE(ABORT, 'invalid product backorder policy'); END;

      CREATE TRIGGER IF NOT EXISTS products_backorder_update_valid
      BEFORE UPDATE OF backorderable, backorder_lead_days ON products
      WHEN NEW.backorderable NOT IN (0, 1)
        OR (NEW.backorderable = 0 AND NEW.backorder_lead_days IS NOT NULL)
        OR (NEW.backorderable = 1 AND (
          typeof(NEW.backorder_lead_days) <> 'integer'
          OR NEW.backorder_lead_days < 1 OR NEW.backorder_lead_days > 365
        ))
      BEGIN SELECT RAISE(ABORT, 'invalid product backorder policy'); END;

      CREATE TABLE IF NOT EXISTS inventory_reservations (
        payment_idempotency_key TEXT NOT NULL REFERENCES payments(idempotency_key) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id),
        demand_kind TEXT NOT NULL CHECK (demand_kind IN ('product', 'powder_mix')),
        reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK (typeof(reserved_quantity) = 'integer' AND reserved_quantity >= 0),
        backordered_quantity INTEGER NOT NULL DEFAULT 0 CHECK (typeof(backordered_quantity) = 'integer' AND backordered_quantity >= 0),
        expires_at TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (payment_idempotency_key, product_id, demand_kind),
        CHECK (reserved_quantity > 0 OR backordered_quantity > 0),
        CHECK (demand_kind = 'product' OR backordered_quantity = 0)
      );

      CREATE TABLE IF NOT EXISTS order_inventory_allocations (
        order_line_item_id INTEGER PRIMARY KEY REFERENCES order_line_items(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id),
        allocated_quantity INTEGER NOT NULL CHECK (typeof(allocated_quantity) = 'integer' AND allocated_quantity >= 0),
        backordered_quantity INTEGER NOT NULL CHECK (typeof(backordered_quantity) = 'integer' AND backordered_quantity >= 0),
        cancelled_quantity INTEGER NOT NULL DEFAULT 0 CHECK (typeof(cancelled_quantity) = 'integer' AND cancelled_quantity >= 0),
        stock_debited_quantity INTEGER NOT NULL DEFAULT 0 CHECK (typeof(stock_debited_quantity) = 'integer' AND stock_debited_quantity >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS inventory_receipts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        idempotency_key TEXT NOT NULL UNIQUE,
        request_fingerprint TEXT NOT NULL,
        product_id INTEGER NOT NULL REFERENCES products(id),
        received_quantity INTEGER NOT NULL CHECK (typeof(received_quantity) = 'integer' AND received_quantity > 0),
        response_json TEXT NOT NULL,
        received_by_user_id INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS inventory_stock_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id),
        movement_type TEXT NOT NULL CHECK (movement_type IN (
          'checkout_consumed', 'receipt_received', 'backorder_allocated', 'cancellation_restored'
        )),
        quantity_delta INTEGER NOT NULL CHECK (typeof(quantity_delta) = 'integer' AND quantity_delta <> 0),
        payment_idempotency_key TEXT REFERENCES payments(idempotency_key) ON DELETE SET NULL,
        order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
        order_line_item_id INTEGER REFERENCES order_line_items(id) ON DELETE SET NULL,
        receipt_id INTEGER REFERENCES inventory_receipts(id) ON DELETE SET NULL,
        occurred_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS inventory_reservations_product_expiry_idx
        ON inventory_reservations(product_id, expires_at);
      CREATE INDEX IF NOT EXISTS inventory_reservations_payment_idx
        ON inventory_reservations(payment_idempotency_key);
      CREATE INDEX IF NOT EXISTS order_inventory_allocations_open_fifo_idx
        ON order_inventory_allocations(product_id, created_at, order_line_item_id)
        WHERE backordered_quantity > 0;
      CREATE INDEX IF NOT EXISTS order_inventory_allocations_product_idx
        ON order_inventory_allocations(product_id);
      CREATE INDEX IF NOT EXISTS inventory_stock_movements_product_occurred_idx
        ON inventory_stock_movements(product_id, occurred_at, id);
      CREATE INDEX IF NOT EXISTS inventory_stock_movements_order_idx
        ON inventory_stock_movements(order_id);

      CREATE TRIGGER IF NOT EXISTS inventory_stock_movements_no_update
      BEFORE UPDATE ON inventory_stock_movements
      BEGIN SELECT RAISE(ABORT, 'inventory_stock_movements are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS inventory_stock_movements_no_delete
      BEFORE DELETE ON inventory_stock_movements
      BEGIN SELECT RAISE(ABORT, 'inventory_stock_movements are immutable'); END;
    `);

    if (hasTable(db, 'powder_mix_stock_reservations')) {
      const legacyReservations = db
        .prepare(
          `SELECT reservation.payment_idempotency_key, reservation.product_id, reservation.bag_equivalents,
                  payment.status, payment.updated_at, payment.created_at
           FROM powder_mix_stock_reservations reservation
           JOIN payments payment ON payment.idempotency_key = reservation.payment_idempotency_key
           WHERE payment.status IN ('prepared', 'authorized_pending_finalize')`,
        )
        .all() as Array<{
        payment_idempotency_key: string;
        product_id: number;
        bag_equivalents: number;
        status: string;
        updated_at: string | null;
        created_at: string;
      }>;
      const insertReservation = db.prepare(
        `INSERT INTO inventory_reservations
          (payment_idempotency_key, product_id, demand_kind, reserved_quantity, backordered_quantity, expires_at, created_at)
         VALUES (?, ?, 'powder_mix', ?, 0, ?, ?)`,
      );
      const updateExpiry = db.prepare(
        `UPDATE payments SET reservation_expires_at = ?
         WHERE idempotency_key = ? AND reservation_expires_at IS NULL`,
      );
      for (const reservation of legacyReservations) {
        const sourceTime = reservation.updated_at ?? reservation.created_at;
        const expiresAt =
          reservation.status === 'prepared'
            ? new Date(Date.parse(sourceTime) + 15 * 60_000).toISOString()
            : null;
        insertReservation.run(
          reservation.payment_idempotency_key,
          reservation.product_id,
          reservation.bag_equivalents,
          expiresAt,
          sourceTime,
        );
        if (expiresAt) updateExpiry.run(expiresAt, reservation.payment_idempotency_key);
      }
      const copiedCount = (
        db
          .prepare(
            `SELECT COUNT(*) AS count FROM inventory_reservations
             WHERE demand_kind = 'powder_mix'`,
          )
          .get() as { count: number }
      ).count;
      if (copiedCount !== legacyReservations.length) {
        throw new Error('Legacy inventory reservation copy count mismatch');
      }
      const missingCopyCount = (
        db
          .prepare(
            `SELECT COUNT(*) AS count
             FROM powder_mix_stock_reservations reservation
             JOIN payments payment ON payment.idempotency_key = reservation.payment_idempotency_key
             WHERE payment.status IN ('prepared', 'authorized_pending_finalize')
               AND NOT EXISTS (
                 SELECT 1 FROM inventory_reservations inventory
                 WHERE inventory.payment_idempotency_key = reservation.payment_idempotency_key
                   AND inventory.product_id = reservation.product_id
                   AND inventory.demand_kind = 'powder_mix'
                   AND inventory.reserved_quantity = reservation.bag_equivalents
                   AND inventory.backordered_quantity = 0
               )`,
          )
          .get() as { count: number }
      ).count;
      if (missingCopyCount !== 0) {
        throw new Error('Legacy inventory reservation copy identity mismatch');
      }
      db.exec('DROP TABLE powder_mix_stock_reservations');
    }

    db.prepare(
      `INSERT INTO order_inventory_allocations
        (order_line_item_id, product_id, allocated_quantity, backordered_quantity, cancelled_quantity,
         stock_debited_quantity, created_at, updated_at)
       SELECT line.id, line.product_id, line.quantity, 0, 0, 0, orders.created_at, orders.created_at
       FROM order_line_items line
       JOIN orders ON orders.id = line.order_id
       WHERE NOT EXISTS (
         SELECT 1 FROM order_inventory_allocations allocation
         WHERE allocation.order_line_item_id = line.id
       )`,
    ).run();
  },
};
