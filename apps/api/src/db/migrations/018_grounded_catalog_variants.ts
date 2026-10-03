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

/** Rebuilds legacy catalog to variant-aware schema. Atomic transaction protects all data. */
export const groundedCatalogVariantsMigration: Migration = {
  version: '018',
  name: 'grounded catalog variants',
  up(db) {
    // -----------------------------------------------------------------------
    // 1. Create product_variants table
    // -----------------------------------------------------------------------
    db.exec(`
      CREATE TABLE IF NOT EXISTS product_variants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id),
        sku TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        weight_grams INTEGER NOT NULL,
        price_cents INTEGER NOT NULL,
        compare_at_price_cents INTEGER,
        stock_count INTEGER NOT NULL DEFAULT 0,
        backorderable INTEGER NOT NULL DEFAULT 0,
        backorder_lead_days INTEGER,
        delivery_class TEXT NOT NULL DEFAULT 'parcel',
        active INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(product_id, sort_order)
      );
    `);

    // -----------------------------------------------------------------------
    // 2. Alter products: add classification, mixing-group, details, variant-ref columns
    // -----------------------------------------------------------------------
    addColumnIfMissing(
      db,
      'products',
      'consumption_classification',
      "TEXT NOT NULL DEFAULT 'non-food'",
    );
    addColumnIfMissing(db, 'products', 'mixing_group', 'TEXT');
    addColumnIfMissing(db, 'products', 'details_json', 'TEXT');
    addColumnIfMissing(db, 'products', 'default_variant_id', 'INTEGER');
    addColumnIfMissing(db, 'products', 'blend_source_variant_id', 'INTEGER');

    // -----------------------------------------------------------------------
    // 3-4. Backfill default variants and set products.default_variant_id
    // -----------------------------------------------------------------------
    const productRows = db
      .prepare(
        `SELECT id, name, price_cents, stock_count, backorderable, backorder_lead_days, created_at
         FROM products`,
      )
      .all() as Array<{
      id: number;
      name: string;
      price_cents: number;
      stock_count: number;
      backorderable: number;
      backorder_lead_days: number | null;
      created_at: string;
    }>;

    const insertVariant = db.prepare(`
      INSERT INTO product_variants
        (product_id, sku, label, weight_grams, price_cents, stock_count,
         backorderable, backorder_lead_days, delivery_class, active, sort_order,
         created_at, updated_at)
      VALUES (?, ?, ?, 1000, ?, ?, ?, ?, 'parcel', 1, 0, ?, ?)
    `);
    const updateDefaultVariant = db.prepare(
      'UPDATE products SET default_variant_id = ? WHERE id = ?',
    );

    if (productRows.length > 0) {
      for (const product of productRows) {
        const sku = `LEGACY-${product.id}-001`;
        const label = `${product.name} (Legacy)`;
        const createdAt = product.created_at;
        const backorderLead = product.backorderable ? product.backorder_lead_days : null;
        const result = insertVariant.run(
          product.id,
          sku,
          label,
          product.price_cents,
          product.stock_count,
          product.backorderable ?? 0,
          backorderLead,
          createdAt,
          createdAt,
        );
        updateDefaultVariant.run(result.lastInsertRowid, product.id);
      }

      const missingDefault = (
        db
          .prepare('SELECT COUNT(*) AS count FROM products WHERE default_variant_id IS NULL')
          .get() as { count: number }
      ).count;
      if (missingDefault > 0) {
        throw new Error(`${missingDefault} products missing default_variant_id after backfill`);
      }

      const variantCount = (
        db.prepare('SELECT COUNT(*) AS count FROM product_variants').get() as { count: number }
      ).count;
      if (variantCount !== productRows.length) {
        throw new Error(
          `Variant backfill count mismatch: ${productRows.length} products vs ${variantCount} variants`,
        );
      }
    }

    // -----------------------------------------------------------------------
    // 5. Rebuild cart_line_items: product_id -> variant_id, add timestamps
    // -----------------------------------------------------------------------
    {
      const cartLineCount = (
        db.prepare('SELECT COUNT(*) AS count FROM cart_line_items').get() as { count: number }
      ).count;

      db.pragma('foreign_keys = OFF');
      try {
        db.exec(`
          CREATE TABLE cart_line_items_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cart_id TEXT NOT NULL,
            variant_id INTEGER NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE CASCADE,
            FOREIGN KEY (variant_id) REFERENCES product_variants(id),
            UNIQUE(cart_id, variant_id)
          );
        `);

        if (cartLineCount > 0) {
          db.exec(`
            INSERT INTO cart_line_items_new (id, cart_id, variant_id, quantity, created_at, updated_at)
            SELECT old.id, old.cart_id, p.default_variant_id, old.quantity,
                   datetime('now'), datetime('now')
            FROM cart_line_items old
            JOIN products p ON p.id = old.product_id
          `);

          const copiedCount = (
            db.prepare('SELECT COUNT(*) AS count FROM cart_line_items_new').get() as {
              count: number;
            }
          ).count;
          if (copiedCount !== cartLineCount) {
            throw new Error(
              `Cart line item rebuild count mismatch: ${cartLineCount} existing vs ${copiedCount} new`,
            );
          }
        }

        db.exec('DROP TABLE cart_line_items');
        db.exec('ALTER TABLE cart_line_items_new RENAME TO cart_line_items');
      } finally {
        db.pragma('foreign_keys = ON');
      }
    }

    // -----------------------------------------------------------------------
    // 6. Rebuild inventory_reservations: product_id -> variant_id
    // -----------------------------------------------------------------------
    if (hasTable(db, 'inventory_reservations')) {
      const existingCount = (
        db.prepare('SELECT COUNT(*) AS count FROM inventory_reservations').get() as {
          count: number;
        }
      ).count;
      const existingRows =
        existingCount > 0
          ? db
              .prepare(
                `SELECT payment_idempotency_key, product_id, demand_kind, reserved_quantity,
                        backordered_quantity, expires_at, created_at
                 FROM inventory_reservations
                 ORDER BY payment_idempotency_key, product_id, demand_kind`,
              )
              .all()
          : [];

      db.pragma('foreign_keys = OFF');
      try {
        db.exec(`
          CREATE TABLE inventory_reservations_new (
            payment_idempotency_key TEXT NOT NULL REFERENCES payments(idempotency_key) ON DELETE CASCADE,
            variant_id INTEGER NOT NULL REFERENCES product_variants(id),
            demand_kind TEXT NOT NULL CHECK (demand_kind IN ('product', 'powder_mix')),
            reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK (
              typeof(reserved_quantity) = 'integer' AND reserved_quantity >= 0
            ),
            backordered_quantity INTEGER NOT NULL DEFAULT 0 CHECK (
              typeof(backordered_quantity) = 'integer' AND backordered_quantity >= 0
            ),
            expires_at TEXT,
            created_at TEXT NOT NULL,
            PRIMARY KEY (payment_idempotency_key, variant_id, demand_kind),
            CHECK (reserved_quantity > 0 OR backordered_quantity > 0),
            CHECK (demand_kind = 'product' OR backordered_quantity = 0)
          );
        `);

        if (existingCount > 0) {
          db.exec(`
            INSERT INTO inventory_reservations_new
              (payment_idempotency_key, variant_id, demand_kind, reserved_quantity,
               backordered_quantity, expires_at, created_at)
            SELECT old.payment_idempotency_key, p.default_variant_id, old.demand_kind,
                   old.reserved_quantity, old.backordered_quantity, old.expires_at, old.created_at
            FROM inventory_reservations old
            JOIN products p ON p.id = old.product_id
            ORDER BY old.payment_idempotency_key, old.product_id, old.demand_kind
          `);

          const newCount = (
            db.prepare('SELECT COUNT(*) AS count FROM inventory_reservations_new').get() as {
              count: number;
            }
          ).count;
          if (newCount !== existingCount) {
            throw new Error(
              `Inventory reservations rebuild count mismatch: ${existingCount} vs ${newCount}`,
            );
          }

          const newRows = db
            .prepare(
              `SELECT payment_idempotency_key, variant_id, demand_kind, reserved_quantity,
                      backordered_quantity, expires_at, created_at
               FROM inventory_reservations_new
               ORDER BY payment_idempotency_key, variant_id, demand_kind`,
            )
            .all();
          if (newRows.length !== existingRows.length) {
            throw new Error('Inventory reservations row length mismatch after copy');
          }
          for (let i = 0; i < existingRows.length; i++) {
            const oldRow = existingRows[i] as Record<string, unknown>;
            const newRow = newRows[i] as Record<string, unknown>;
            for (const key of [
              'payment_idempotency_key',
              'demand_kind',
              'reserved_quantity',
              'backordered_quantity',
              'expires_at',
              'created_at',
            ]) {
              if (
                (oldRow[key] === null && newRow[key] !== null) ||
                (oldRow[key] !== null && oldRow[key] !== newRow[key])
              ) {
                throw new Error(`Inventory reservation row ${i} column ${key} identity mismatch`);
              }
            }
          }
        }

        db.exec('DROP TABLE inventory_reservations');
        db.exec('ALTER TABLE inventory_reservations_new RENAME TO inventory_reservations');

        db.exec(`
          CREATE INDEX inventory_reservations_variant_expiry_idx
            ON inventory_reservations(variant_id, expires_at);
          CREATE INDEX inventory_reservations_payment_idx
            ON inventory_reservations(payment_idempotency_key);
        `);
      } finally {
        db.pragma('foreign_keys = ON');
      }
    } else {
      db.exec(`
        CREATE TABLE IF NOT EXISTS inventory_reservations (
          payment_idempotency_key TEXT NOT NULL REFERENCES payments(idempotency_key) ON DELETE CASCADE,
          variant_id INTEGER NOT NULL REFERENCES product_variants(id),
          demand_kind TEXT NOT NULL CHECK (demand_kind IN ('product', 'powder_mix')),
          reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK (
            typeof(reserved_quantity) = 'integer' AND reserved_quantity >= 0
          ),
          backordered_quantity INTEGER NOT NULL DEFAULT 0 CHECK (
            typeof(backordered_quantity) = 'integer' AND backordered_quantity >= 0
          ),
          expires_at TEXT,
          created_at TEXT NOT NULL,
          PRIMARY KEY (payment_idempotency_key, variant_id, demand_kind),
          CHECK (reserved_quantity > 0 OR backordered_quantity > 0),
          CHECK (demand_kind = 'product' OR backordered_quantity = 0)
        );
        CREATE INDEX IF NOT EXISTS inventory_reservations_variant_expiry_idx
          ON inventory_reservations(variant_id, expires_at);
        CREATE INDEX IF NOT EXISTS inventory_reservations_payment_idx
          ON inventory_reservations(payment_idempotency_key);
      `);
    }

    // -----------------------------------------------------------------------
    // 7. Rebuild order_inventory_allocations: product_id -> variant_id
    // -----------------------------------------------------------------------
    if (hasTable(db, 'order_inventory_allocations')) {
      const existingCount = (
        db.prepare('SELECT COUNT(*) AS count FROM order_inventory_allocations').get() as {
          count: number;
        }
      ).count;
      const existingRows =
        existingCount > 0
          ? db
              .prepare(
                `SELECT order_line_item_id, product_id, allocated_quantity, backordered_quantity,
                        cancelled_quantity, stock_debited_quantity, created_at, updated_at
                 FROM order_inventory_allocations ORDER BY order_line_item_id`,
              )
              .all()
          : [];

      db.pragma('foreign_keys = OFF');
      try {
        db.exec(`
          CREATE TABLE order_inventory_allocations_new (
            order_line_item_id INTEGER PRIMARY KEY REFERENCES order_line_items(id) ON DELETE CASCADE,
            variant_id INTEGER NOT NULL REFERENCES product_variants(id),
            allocated_quantity INTEGER NOT NULL CHECK (
              typeof(allocated_quantity) = 'integer' AND allocated_quantity >= 0
            ),
            backordered_quantity INTEGER NOT NULL CHECK (
              typeof(backordered_quantity) = 'integer' AND backordered_quantity >= 0
            ),
            cancelled_quantity INTEGER NOT NULL DEFAULT 0 CHECK (
              typeof(cancelled_quantity) = 'integer' AND cancelled_quantity >= 0
            ),
            stock_debited_quantity INTEGER NOT NULL DEFAULT 0 CHECK (
              typeof(stock_debited_quantity) = 'integer' AND stock_debited_quantity >= 0
            ),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
        `);

        if (existingCount > 0) {
          db.exec(`
            INSERT INTO order_inventory_allocations_new
              (order_line_item_id, variant_id, allocated_quantity, backordered_quantity,
               cancelled_quantity, stock_debited_quantity, created_at, updated_at)
            SELECT old.order_line_item_id, p.default_variant_id, old.allocated_quantity,
                   old.backordered_quantity, old.cancelled_quantity, old.stock_debited_quantity,
                   old.created_at, old.updated_at
            FROM order_inventory_allocations old
            JOIN products p ON p.id = old.product_id
            ORDER BY old.order_line_item_id
          `);

          const newCount = (
            db.prepare('SELECT COUNT(*) AS count FROM order_inventory_allocations_new').get() as {
              count: number;
            }
          ).count;
          if (newCount !== existingCount) {
            throw new Error(
              `Order inventory allocations rebuild count mismatch: ${existingCount} vs ${newCount}`,
            );
          }

          const newRows = db
            .prepare(
              `SELECT order_line_item_id, variant_id, allocated_quantity, backordered_quantity,
                      cancelled_quantity, stock_debited_quantity, created_at, updated_at
               FROM order_inventory_allocations_new ORDER BY order_line_item_id`,
            )
            .all();
          if (newRows.length !== existingRows.length) {
            throw new Error('Order inventory allocations row length mismatch after copy');
          }
          for (let i = 0; i < existingRows.length; i++) {
            const oldRow = existingRows[i] as Record<string, unknown>;
            const newRow = newRows[i] as Record<string, unknown>;
            for (const key of [
              'order_line_item_id',
              'allocated_quantity',
              'backordered_quantity',
              'cancelled_quantity',
              'stock_debited_quantity',
              'created_at',
              'updated_at',
            ]) {
              if (
                (oldRow[key] === null && newRow[key] !== null) ||
                (oldRow[key] !== null && oldRow[key] !== newRow[key])
              ) {
                throw new Error(
                  `Order inventory allocation row ${i} column ${key} identity mismatch`,
                );
              }
            }
          }
        }

        db.exec('DROP TABLE order_inventory_allocations');
        db.exec(
          'ALTER TABLE order_inventory_allocations_new RENAME TO order_inventory_allocations',
        );

        db.exec(`
          CREATE INDEX order_inventory_allocations_open_fifo_idx
            ON order_inventory_allocations(variant_id, created_at, order_line_item_id)
            WHERE backordered_quantity > 0;
          CREATE INDEX order_inventory_allocations_variant_idx
            ON order_inventory_allocations(variant_id);
        `);
      } finally {
        db.pragma('foreign_keys = ON');
      }
    } else {
      db.exec(`
        CREATE TABLE IF NOT EXISTS order_inventory_allocations (
          order_line_item_id INTEGER PRIMARY KEY REFERENCES order_line_items(id) ON DELETE CASCADE,
          variant_id INTEGER NOT NULL REFERENCES product_variants(id),
          allocated_quantity INTEGER NOT NULL CHECK (
            typeof(allocated_quantity) = 'integer' AND allocated_quantity >= 0
          ),
          backordered_quantity INTEGER NOT NULL CHECK (
            typeof(backordered_quantity) = 'integer' AND backordered_quantity >= 0
          ),
          cancelled_quantity INTEGER NOT NULL DEFAULT 0 CHECK (
            typeof(cancelled_quantity) = 'integer' AND cancelled_quantity >= 0
          ),
          stock_debited_quantity INTEGER NOT NULL DEFAULT 0 CHECK (
            typeof(stock_debited_quantity) = 'integer' AND stock_debited_quantity >= 0
          ),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS order_inventory_allocations_open_fifo_idx
          ON order_inventory_allocations(variant_id, created_at, order_line_item_id)
          WHERE backordered_quantity > 0;
        CREATE INDEX IF NOT EXISTS order_inventory_allocations_variant_idx
          ON order_inventory_allocations(variant_id);
      `);
    }

    // -----------------------------------------------------------------------
    // 8. Alter inventory_receipts: add variant_id (alongside product_id)
    // -----------------------------------------------------------------------
    if (hasTable(db, 'inventory_receipts')) {
      addColumnIfMissing(db, 'inventory_receipts', 'variant_id', 'INTEGER');
      db.exec(`
        UPDATE inventory_receipts
        SET variant_id = (
          SELECT p.default_variant_id
          FROM products p
          WHERE p.id = inventory_receipts.product_id
        )
        WHERE variant_id IS NULL
      `);
    }

    // -----------------------------------------------------------------------
    // 9. Rebuild inventory_stock_movements: product_id -> variant_id
    // -----------------------------------------------------------------------
    if (hasTable(db, 'inventory_stock_movements')) {
      const existingCount = (
        db.prepare('SELECT COUNT(*) AS count FROM inventory_stock_movements').get() as {
          count: number;
        }
      ).count;
      const existingRows =
        existingCount > 0
          ? db
              .prepare(
                `SELECT id, product_id, movement_type, quantity_delta, payment_idempotency_key,
                        order_id, order_line_item_id, receipt_id, return_request_id, occurred_at
                 FROM inventory_stock_movements ORDER BY id`,
              )
              .all()
          : [];

      db.pragma('foreign_keys = OFF');
      try {
        db.exec(`
          CREATE TABLE inventory_stock_movements_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            variant_id INTEGER NOT NULL REFERENCES product_variants(id),
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
        `);

        if (existingCount > 0) {
          db.exec(`
            INSERT INTO inventory_stock_movements_new
              (id, variant_id, movement_type, quantity_delta, payment_idempotency_key,
               order_id, order_line_item_id, receipt_id, return_request_id, occurred_at)
            SELECT old.id, p.default_variant_id, old.movement_type, old.quantity_delta,
                   old.payment_idempotency_key, old.order_id, old.order_line_item_id,
                   old.receipt_id, old.return_request_id, old.occurred_at
            FROM inventory_stock_movements old
            JOIN products p ON p.id = old.product_id
            ORDER BY old.id
          `);

          const newCount = (
            db.prepare('SELECT COUNT(*) AS count FROM inventory_stock_movements_new').get() as {
              count: number;
            }
          ).count;
          if (newCount !== existingCount) {
            throw new Error(
              `Inventory stock movements rebuild count mismatch: ${existingCount} vs ${newCount}`,
            );
          }

          const newRows = db
            .prepare(
              `SELECT id, variant_id, movement_type, quantity_delta, payment_idempotency_key,
                      order_id, order_line_item_id, receipt_id, return_request_id, occurred_at
               FROM inventory_stock_movements_new ORDER BY id`,
            )
            .all();
          if (newRows.length !== existingRows.length) {
            throw new Error('Inventory stock movements row length mismatch after copy');
          }
          for (let i = 0; i < existingRows.length; i++) {
            const oldRow = existingRows[i] as Record<string, unknown>;
            const newRow = newRows[i] as Record<string, unknown>;
            for (const key of [
              'id',
              'movement_type',
              'quantity_delta',
              'payment_idempotency_key',
              'order_id',
              'order_line_item_id',
              'receipt_id',
              'return_request_id',
              'occurred_at',
            ]) {
              if (
                (oldRow[key] === null && newRow[key] !== null) ||
                (oldRow[key] !== null && oldRow[key] !== newRow[key])
              ) {
                throw new Error(
                  `Inventory stock movement row ${i} column ${key} identity mismatch`,
                );
              }
            }
          }
        }

        db.exec('DROP TABLE inventory_stock_movements');
        db.exec('ALTER TABLE inventory_stock_movements_new RENAME TO inventory_stock_movements');

        db.exec(`
          CREATE INDEX inventory_stock_movements_variant_occurred_idx
            ON inventory_stock_movements(variant_id, occurred_at, id);
          CREATE INDEX inventory_stock_movements_order_idx
            ON inventory_stock_movements(order_id);
          CREATE INDEX inventory_stock_movements_return_idx
            ON inventory_stock_movements(return_request_id);
        `);

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
    } else {
      db.exec(`
        CREATE TABLE IF NOT EXISTS inventory_stock_movements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          variant_id INTEGER NOT NULL REFERENCES product_variants(id),
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
        CREATE INDEX IF NOT EXISTS inventory_stock_movements_variant_occurred_idx
          ON inventory_stock_movements(variant_id, occurred_at, id);
        CREATE INDEX IF NOT EXISTS inventory_stock_movements_order_idx
          ON inventory_stock_movements(order_id);
        CREATE INDEX IF NOT EXISTS inventory_stock_movements_return_idx
          ON inventory_stock_movements(return_request_id);
        CREATE TRIGGER IF NOT EXISTS inventory_stock_movements_no_update
        BEFORE UPDATE ON inventory_stock_movements
        BEGIN SELECT RAISE(ABORT, 'inventory_stock_movements are immutable'); END;
        CREATE TRIGGER IF NOT EXISTS inventory_stock_movements_no_delete
        BEFORE DELETE ON inventory_stock_movements
        BEGIN SELECT RAISE(ABORT, 'inventory_stock_movements are immutable'); END;
      `);
    }

    // -----------------------------------------------------------------------
    // 10. Extend curated_bundle_components with variant_id
    // -----------------------------------------------------------------------
    addColumnIfMissing(db, 'curated_bundle_components', 'variant_id', 'INTEGER');
    db.exec(`
      UPDATE curated_bundle_components
      SET variant_id = (
        SELECT p.default_variant_id
        FROM products p
        WHERE p.id = curated_bundle_components.product_id
      )
      WHERE variant_id IS NULL
    `);

    // -----------------------------------------------------------------------
    // 11. Extend orders with delivery columns
    // -----------------------------------------------------------------------
    addColumnIfMissing(db, 'orders', 'delivery_mode', "TEXT DEFAULT 'parcel'");
    addColumnIfMissing(db, 'orders', 'delivery_charge_cents', 'INTEGER DEFAULT 0');
    addColumnIfMissing(db, 'orders', 'delivery_weight_grams', 'INTEGER DEFAULT 0');

    // -----------------------------------------------------------------------
    // 12. Extend order_line_items with variant snapshot columns
    // -----------------------------------------------------------------------
    addColumnIfMissing(db, 'order_line_items', 'variant_id', 'INTEGER');
    addColumnIfMissing(db, 'order_line_items', 'sku', 'TEXT');
    addColumnIfMissing(db, 'order_line_items', 'variant_label', 'TEXT');
    addColumnIfMissing(db, 'order_line_items', 'weight_grams', 'INTEGER');
    addColumnIfMissing(db, 'order_line_items', 'consumption_classification', 'TEXT');
    addColumnIfMissing(db, 'order_line_items', 'delivery_class', "TEXT DEFAULT 'parcel'");

    // -----------------------------------------------------------------------
    // 13. Validate
    // -----------------------------------------------------------------------
    const fkViolations = db.pragma('foreign_key_check') as unknown[];
    if (fkViolations && fkViolations.length > 0) {
      throw new Error(
        `Foreign key violations after v18 migration: ${JSON.stringify(fkViolations)}`,
      );
    }

    const danglingDefaults = (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM products p
           WHERE p.default_variant_id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.id = p.default_variant_id)`,
        )
        .get() as { count: number }
    ).count;
    if (danglingDefaults > 0) {
      throw new Error(`${danglingDefaults} products have dangling default_variant_id`);
    }
  },
};
