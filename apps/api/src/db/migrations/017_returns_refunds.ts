import type { Migration } from '../migrate.js';

function hasTable(db: Parameters<Migration['up']>[0], table: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
  );
}

/** Adds return/refund tables and extends inventory movements with return_received support. */
export const returnsRefundsMigration: Migration = {
  version: '017',
  name: 'returns and refunds',
  up(db) {
    // -----------------------------------------------------------------------
    // Return request tables
    // -----------------------------------------------------------------------
    db.exec(`
      CREATE TABLE return_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN (
          'requested', 'approved', 'rejected', 'received', 'refunded'
        )),
        reason TEXT NOT NULL CHECK (reason IN (
          'damaged', 'wrong_item', 'not_as_expected', 'other'
        )),
        note TEXT CHECK (note IS NULL OR (note = trim(note) AND length(note) BETWEEN 1 AND 500)),
        version INTEGER NOT NULL DEFAULT 0 CHECK (typeof(version) = 'integer' AND version >= 0),
        requested_at TEXT NOT NULL,
        approved_at TEXT,
        rejected_at TEXT,
        received_at TEXT,
        refunded_at TEXT,
        CHECK (
          (status = 'requested' AND approved_at IS NULL AND rejected_at IS NULL AND received_at IS NULL AND refunded_at IS NULL)
          OR (status = 'approved' AND approved_at IS NOT NULL AND rejected_at IS NULL AND received_at IS NULL AND refunded_at IS NULL)
          OR (status = 'rejected' AND rejected_at IS NOT NULL AND approved_at IS NULL AND received_at IS NULL AND refunded_at IS NULL)
          OR (status = 'received' AND received_at IS NOT NULL AND approved_at IS NOT NULL AND rejected_at IS NULL AND refunded_at IS NULL)
          OR (status = 'refunded' AND refunded_at IS NOT NULL AND received_at IS NOT NULL AND approved_at IS NOT NULL AND rejected_at IS NULL)
        )
      );

      CREATE INDEX return_requests_user_order_idx
        ON return_requests(user_id, order_id, requested_at DESC, id DESC);
      CREATE INDEX return_requests_status_created_idx
        ON return_requests(status, requested_at, id);

      CREATE TABLE return_request_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        return_request_id INTEGER NOT NULL REFERENCES return_requests(id) ON DELETE CASCADE,
        shipment_id INTEGER NOT NULL REFERENCES order_shipments(id) ON DELETE CASCADE,
        order_line_item_id INTEGER NOT NULL REFERENCES order_line_items(id) ON DELETE CASCADE,
        quantity INTEGER NOT NULL CHECK (typeof(quantity) = 'integer' AND quantity > 0),
        product_name TEXT NOT NULL CHECK (length(product_name) >= 1),
        delivered_at TEXT NOT NULL,
        window_closes_at TEXT NOT NULL,
        UNIQUE (return_request_id, shipment_id, order_line_item_id)
      );

      CREATE INDEX return_request_items_order_line_idx
        ON return_request_items(order_line_item_id);
    `);

    // -----------------------------------------------------------------------
    // Return events (immutable)
    // -----------------------------------------------------------------------
    db.exec(`
      CREATE TABLE return_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        return_request_id INTEGER NOT NULL REFERENCES return_requests(id) ON DELETE CASCADE,
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL CHECK (event_type IN (
          'return.requested',
          'return.approved',
          'return.rejected',
          'return.received',
          'payment.refunded'
        )),
        actor_user_id INTEGER NOT NULL REFERENCES users(id),
        idempotency_key TEXT NOT NULL,
        request_fingerprint TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        UNIQUE (idempotency_key)
      );

      CREATE INDEX return_events_return_chrono_idx
        ON return_events(return_request_id, occurred_at, id);
      CREATE INDEX return_events_order_chrono_idx
        ON return_events(order_id, occurred_at, id);

      CREATE TRIGGER return_events_no_update
      BEFORE UPDATE ON return_events
      BEGIN
        SELECT RAISE(ABORT, 'return_events are immutable');
      END;

      CREATE TRIGGER return_events_no_delete
      BEFORE DELETE ON return_events
      BEGIN
        SELECT RAISE(ABORT, 'return_events are immutable');
      END;
    `);

    // -----------------------------------------------------------------------
    // Refunds (immutable)
    // -----------------------------------------------------------------------
    db.exec(`
      CREATE TABLE refunds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        return_request_id INTEGER NOT NULL UNIQUE REFERENCES return_requests(id) ON DELETE CASCADE,
        payment_id INTEGER NOT NULL REFERENCES payments(id),
        idempotency_key TEXT NOT NULL UNIQUE,
        gross_subtotal_cents INTEGER NOT NULL CHECK (
          typeof(gross_subtotal_cents) = 'integer' AND gross_subtotal_cents >= 0
        ),
        discount_share_cents INTEGER NOT NULL CHECK (
          typeof(discount_share_cents) = 'integer' AND discount_share_cents >= 0
        ),
        net_refund_cents INTEGER NOT NULL CHECK (
          typeof(net_refund_cents) = 'integer' AND net_refund_cents >= 0
        ),
        processor TEXT NOT NULL DEFAULT 'simulated' CHECK (processor = 'simulated'),
        simulated_reference TEXT NOT NULL CHECK (length(simulated_reference) >= 1),
        created_at TEXT NOT NULL,
        CHECK (gross_subtotal_cents - discount_share_cents = net_refund_cents)
      );

      CREATE INDEX refunds_payment_idx ON refunds(payment_id);

      CREATE TRIGGER refunds_no_update
      BEFORE UPDATE ON refunds
      BEGIN
        SELECT RAISE(ABORT, 'refunds are immutable');
      END;

      CREATE TRIGGER refunds_no_delete
      BEFORE DELETE ON refunds
      BEGIN
        SELECT RAISE(ABORT, 'refunds are immutable');
      END;

      CREATE TABLE refund_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        refund_id INTEGER NOT NULL REFERENCES refunds(id) ON DELETE CASCADE,
        return_request_item_id INTEGER NOT NULL REFERENCES return_request_items(id) ON DELETE CASCADE,
        quantity INTEGER NOT NULL CHECK (typeof(quantity) = 'integer' AND quantity > 0),
        gross_subtotal_cents INTEGER NOT NULL CHECK (
          typeof(gross_subtotal_cents) = 'integer' AND gross_subtotal_cents >= 0
        ),
        discount_share_cents INTEGER NOT NULL CHECK (
          typeof(discount_share_cents) = 'integer' AND discount_share_cents >= 0
        ),
        net_refund_cents INTEGER NOT NULL CHECK (
          typeof(net_refund_cents) = 'integer' AND net_refund_cents >= 0
        ),
        UNIQUE (refund_id, return_request_item_id),
        CHECK (gross_subtotal_cents - discount_share_cents = net_refund_cents)
      );

      CREATE INDEX refund_items_return_item_idx ON refund_items(return_request_item_id);

      CREATE TRIGGER refund_items_no_update
      BEFORE UPDATE ON refund_items
      BEGIN
        SELECT RAISE(ABORT, 'refund_items are immutable');
      END;

      CREATE TRIGGER refund_items_no_delete
      BEFORE DELETE ON refund_items
      BEGIN
        SELECT RAISE(ABORT, 'refund_items are immutable');
      END;
    `);

    // -----------------------------------------------------------------------
    // Rebuild inventory_stock_movements with return_received support
    // -----------------------------------------------------------------------
    if (hasTable(db, 'inventory_stock_movements')) {
      // Snapshot existing row count and identity for verification
      const existingCount = (
        db.prepare('SELECT COUNT(*) AS count FROM inventory_stock_movements').get() as {
          count: number;
        }
      ).count;
      const existingRows = db
        .prepare(
          'SELECT id, product_id, movement_type, quantity_delta, payment_idempotency_key, order_id, order_line_item_id, receipt_id, occurred_at FROM inventory_stock_movements ORDER BY id',
        )
        .all();

      db.pragma('foreign_keys = OFF');

      try {
        // Create new table with extended schema
        db.exec(`
          CREATE TABLE inventory_stock_movements_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL REFERENCES products(id),
            movement_type TEXT NOT NULL CHECK (movement_type IN (
              'checkout_consumed', 'receipt_received', 'backorder_allocated',
              'cancellation_restored', 'return_received'
            )),
            quantity_delta INTEGER NOT NULL CHECK (
              typeof(quantity_delta) = 'integer' AND quantity_delta <> 0
            ),
            payment_idempotency_key TEXT REFERENCES payments(idempotency_key) ON DELETE SET NULL,
            order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
            order_line_item_id INTEGER REFERENCES order_line_items(id) ON DELETE SET NULL,
            receipt_id INTEGER REFERENCES inventory_receipts(id) ON DELETE SET NULL,
            return_request_id INTEGER REFERENCES return_requests(id) ON DELETE SET NULL,
            occurred_at TEXT NOT NULL
          );

          INSERT INTO inventory_stock_movements_new
            (id, product_id, movement_type, quantity_delta, payment_idempotency_key,
             order_id, order_line_item_id, receipt_id, return_request_id, occurred_at)
          SELECT id, product_id, movement_type, quantity_delta, payment_idempotency_key,
                 order_id, order_line_item_id, receipt_id, NULL, occurred_at
          FROM inventory_stock_movements
          ORDER BY id;
        `);

        // Verify row count
        const newCount = (
          db.prepare('SELECT COUNT(*) AS count FROM inventory_stock_movements_new').get() as {
            count: number;
          }
        ).count;
        if (newCount !== existingCount) {
          throw new Error(
            `Inventory movement rebuild count mismatch: ${existingCount} existing vs ${newCount} new`,
          );
        }

        // Verify row identity
        const newRows = db
          .prepare(
            'SELECT id, product_id, movement_type, quantity_delta, payment_idempotency_key, order_id, order_line_item_id, receipt_id, occurred_at FROM inventory_stock_movements_new ORDER BY id',
          )
          .all();
        if (existingRows.length !== newRows.length) {
          throw new Error('Inventory movement rebuild row count mismatch');
        }
        for (let i = 0; i < existingRows.length; i++) {
          const existing = existingRows[i] as Record<string, unknown>;
          const rebuilt = newRows[i] as Record<string, unknown>;
          for (const key of [
            'id',
            'product_id',
            'movement_type',
            'quantity_delta',
            'payment_idempotency_key',
            'order_id',
            'order_line_item_id',
            'receipt_id',
            'occurred_at',
          ]) {
            if (
              (existing[key] === null && rebuilt[key] !== null) ||
              (existing[key] !== null && existing[key] !== rebuilt[key])
            ) {
              throw new Error(
                `Inventory movement rebuild identity mismatch at row ${i}, column ${key}`,
              );
            }
          }
        }

        // Drop old table and rename
        db.exec('DROP TABLE inventory_stock_movements');
        db.exec('ALTER TABLE inventory_stock_movements_new RENAME TO inventory_stock_movements');

        // Recreate indexes
        db.exec(`
          CREATE INDEX inventory_stock_movements_product_occurred_idx
            ON inventory_stock_movements(product_id, occurred_at, id);
          CREATE INDEX inventory_stock_movements_order_idx
            ON inventory_stock_movements(order_id);
          CREATE INDEX inventory_stock_movements_return_idx
            ON inventory_stock_movements(return_request_id);
        `);

        // Recreate immutable triggers
        db.exec(`
          CREATE TRIGGER inventory_stock_movements_no_update
          BEFORE UPDATE ON inventory_stock_movements
          BEGIN SELECT RAISE(ABORT, 'inventory_stock_movements are immutable'); END;
          CREATE TRIGGER inventory_stock_movements_no_delete
          BEFORE DELETE ON inventory_stock_movements
          BEGIN SELECT RAISE(ABORT, 'inventory_stock_movements are immutable'); END;
        `);
      } finally {
        db.pragma('foreign_keys = ON');
      }

      // Verify FK integrity
      const fkViolations = db.pragma('foreign_key_check') as unknown[];
      if (fkViolations && fkViolations.length > 0) {
        throw new Error(
          `Foreign key violations after inventory movement rebuild: ${JSON.stringify(fkViolations)}`,
        );
      }
    }
  },
};
