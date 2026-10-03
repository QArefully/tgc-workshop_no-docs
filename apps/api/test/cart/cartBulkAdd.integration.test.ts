import assert from 'node:assert/strict';
import test from 'node:test';
import type Database from 'better-sqlite3';
import { createUnitOfWork } from '../../src/db/unitOfWork.js';
import { createAuditRepository } from '../../src/features/audit/auditRepository.js';
import { createAuditWriter, type AuditWriter } from '../../src/features/audit/auditService.js';
import { createCartRepository } from '../../src/features/cart/cartRepository.js';
import { createCartService, type CartService } from '../../src/features/cart/cartService.js';
import { createInventoryRepository } from '../../src/features/inventory/inventoryRepository.js';
import { createInventoryService } from '../../src/features/inventory/inventoryService.js';
import { openSeededDatabase } from '../support/seededDatabase.js';

const NOW = new Date('2026-07-31T12:00:00.000Z');
const CONTEXT = { actor: { type: 'anonymous' as const, userId: null }, requestId: 'bulk-add' };

interface Fixture {
  db: Database.Database;
  service: CartService;
  carts: ReturnType<typeof createCartRepository>;
}

function openFixture(
  name: string,
  audit?: AuditWriter,
): Fixture & { cleanup: () => Promise<void> } {
  void name;
  const database = openSeededDatabase();
  const db = database.db;
  const carts = createCartRepository(db);
  const service = createCartService(
    carts,
    {
      unitOfWork: createUnitOfWork(db),
      audit:
        audit ??
        createAuditWriter({ repository: createAuditRepository(db), clock: { now: () => NOW } }),
    },
    {
      inventory: createInventoryService({ repository: createInventoryRepository(db) }),
      clock: { now: () => NOW },
    },
  );
  return {
    db,
    service,
    carts,
    cleanup: async () => {
      await database.cleanup();
    },
  };
}

interface SellableVariant {
  id: number;
  weight_grams: number;
}

/** Picks distinct sellable default variants and pins their inventory facts for the scenario. */
function sellableVariants(db: Database.Database, count: number): SellableVariant[] {
  const rows = db
    .prepare(
      `SELECT id, weight_grams FROM product_variants
       WHERE active = 1 AND sort_order = 1 ORDER BY id LIMIT ?`,
    )
    .all(count) as SellableVariant[];
  assert.equal(rows.length, count, 'seed must expose enough sellable variants');
  return rows;
}

function pin(
  db: Database.Database,
  variantId: number,
  facts: { stock: number; moqSacks: number; backorderable: number },
): void {
  db.prepare(
    'UPDATE product_variants SET stock_count = ?, moq_sacks = ?, backorderable = ? WHERE id = ?',
  ).run(facts.stock, facts.moqSacks, facts.backorderable, variantId);
}

function lineQuantities(db: Database.Database, cartId: string): Array<[number, number]> {
  return (
    db
      .prepare(
        'SELECT variant_id, quantity FROM cart_line_items WHERE cart_id = ? ORDER BY variant_id',
      )
      .all(cartId) as Array<{ variant_id: number; quantity: number }>
  ).map((row) => [row.variant_id, row.quantity]);
}

void test('bulk add commits every eligible line and reports each skip on its own key', (t) => {
  const fixture = openFixture('cart-bulk-mixed');
  t.after(fixture.cleanup);
  const { db, service, carts } = fixture;
  const [ok, short, belowMoq, backordered] = sellableVariants(db, 4) as [
    SellableVariant,
    SellableVariant,
    SellableVariant,
    SellableVariant,
  ];
  pin(db, ok.id, { stock: 1_000, moqSacks: 1, backorderable: 0 });
  pin(db, short.id, { stock: 1, moqSacks: 1, backorderable: 0 });
  pin(db, belowMoq.id, { stock: 1_000, moqSacks: 400, backorderable: 0 });
  pin(db, backordered.id, { stock: 0, moqSacks: 1, backorderable: 1 });

  const { cartId } = service.create(CONTEXT);
  const result = service.addMany(
    cartId,
    [
      { key: 'ok-first-half', variantId: ok.id, quantity: 2 },
      { key: 'short', variantId: short.id, quantity: 5 },
      { key: 'ok-second-half', variantId: ok.id, quantity: 2 },
      { key: 'below-moq', variantId: belowMoq.id, quantity: 1 },
      { key: 'backordered', variantId: backordered.id, quantity: 3 },
      { key: 'missing', variantId: 999_999, quantity: 1 },
    ],
    CONTEXT,
  );
  assert.notEqual(typeof result, 'string');
  if (typeof result === 'string') return;

  assert.deepEqual(
    result.outcomes.map((outcome) => [outcome.key, outcome.status, outcome.reason]),
    [
      ['ok-first-half', 'added', undefined],
      ['short', 'skipped', 'INSUFFICIENT_STOCK'],
      ['ok-second-half', 'added', undefined],
      ['below-moq', 'skipped', 'BELOW_MOQ'],
      ['backordered', 'added', undefined],
      ['missing', 'skipped', 'VARIANT_RETIRED'],
    ],
  );
  // Duplicated identities aggregate into one demand and one line, judged once.
  assert.equal(result.outcomes[0]?.resultingQuantity, 4);
  assert.equal(result.outcomes[2]?.resultingQuantity, 4);
  assert.deepEqual(
    lineQuantities(db, cartId).sort((left, right) => left[0] - right[0]),
    [
      [ok.id, 4],
      [backordered.id, 3],
    ].sort((left, right) => left[0] - right[0]),
  );
  assert.equal(result.cart.items.length, 2);
  assert.equal(
    result.cart.items.find((item) => item.variantSnap?.variantId === ok.id)?.resolvedUnitPriceCents,
    result.outcomes[0]?.resolvedUnitPriceCents,
  );

  // MOQ is cumulative: a second add that clears the floor now succeeds on the same line.
  const followUp = service.addMany(
    cartId,
    [{ key: 'below-moq-topped-up', variantId: belowMoq.id, quantity: 400 }],
    CONTEXT,
  );
  assert.notEqual(typeof followUp, 'string');
  if (typeof followUp === 'string') return;
  assert.equal(followUp.outcomes[0]?.status, 'added');
  assert.equal(carts.lineQuantity(cartId, String(belowMoq.id)), 400);
});

void test('bulk add audits the post-add cumulative line quantity, not the added delta', (t) => {
  const fixture = openFixture('cart-bulk-audit-quantity');
  t.after(fixture.cleanup);
  const { db, service } = fixture;
  const [variant] = sellableVariants(db, 1) as [SellableVariant];
  pin(db, variant.id, { stock: 1_000, moqSacks: 1, backorderable: 0 });

  const { cartId } = service.create(CONTEXT);
  // Seed the line through the single-line path, whose audit metadata is the cumulative quantity.
  assert.notEqual(typeof service.add(cartId, String(variant.id), 4, CONTEXT), 'string');
  assert.notEqual(
    typeof service.addMany(
      cartId,
      [{ key: 'top-up', variantId: variant.id, quantity: 4 }],
      CONTEXT,
    ),
    'string',
  );

  const quantities = (
    db
      .prepare(
        `SELECT metadata_json FROM audit_events
         WHERE action = 'cart.product_added' AND entity_id = ? ORDER BY id`,
      )
      .all(cartId) as Array<{ metadata_json: string }>
  ).map((row) => (JSON.parse(row.metadata_json) as { quantity: number }).quantity);
  // Both emitters describe the same line the same way: 4, then 8 — never the 4-sack delta again.
  assert.deepEqual(quantities, [4, 8]);
  assert.equal(lineQuantities(db, cartId)[0]?.[1], 8);
});

void test('bulk add skips a retired variant without substituting or failing the request', (t) => {
  const fixture = openFixture('cart-bulk-retired');
  t.after(fixture.cleanup);
  const { db, service } = fixture;
  const [live, retired] = sellableVariants(db, 2) as [SellableVariant, SellableVariant];
  pin(db, live.id, { stock: 1_000, moqSacks: 1, backorderable: 0 });
  pin(db, retired.id, { stock: 1_000, moqSacks: 1, backorderable: 0 });
  db.prepare('UPDATE product_variants SET active = 0 WHERE id = ?').run(retired.id);

  const { cartId } = service.create(CONTEXT);
  const result = service.addMany(
    cartId,
    [
      { key: 'retired', variantId: retired.id, quantity: 4 },
      { key: 'live', variantId: live.id, quantity: 4 },
    ],
    CONTEXT,
  );
  assert.notEqual(typeof result, 'string');
  if (typeof result === 'string') return;
  assert.deepEqual(
    result.outcomes.map((outcome) => [outcome.key, outcome.status, outcome.reason]),
    [
      ['retired', 'skipped', 'VARIANT_RETIRED'],
      ['live', 'added', undefined],
    ],
  );
  assert.deepEqual(lineQuantities(db, cartId), [[live.id, 4]]);
});

void test('bulk add rejects the whole request for a missing or reserved cart', (t) => {
  const fixture = openFixture('cart-bulk-reserved');
  t.after(fixture.cleanup);
  const { db, service, carts } = fixture;
  const [variant] = sellableVariants(db, 1) as [SellableVariant];
  pin(db, variant.id, { stock: 1_000, moqSacks: 1, backorderable: 0 });

  assert.equal(
    service.addMany('missing-cart', [{ key: 'a', variantId: variant.id, quantity: 4 }], CONTEXT),
    'CART_NOT_FOUND',
  );

  const { cartId } = service.create(CONTEXT);
  const reservationKey = 'bulk-add-reservation';
  db.prepare(
    `INSERT INTO payments
      (idempotency_key, request_fingerprint, status, amount_cents, card_last4, card_brand,
       reservation_expires_at)
     VALUES (?, ?, 'prepared', 1, '4242', 'Visa', '2026-08-01T12:00:00.000Z')`,
  ).run(reservationKey, reservationKey);
  assert.equal(carts.reserve(cartId, reservationKey, NOW.toISOString()), true);
  assert.equal(
    service.addMany(cartId, [{ key: 'a', variantId: variant.id, quantity: 4 }], CONTEXT),
    'CART_RESERVED',
  );
  assert.deepEqual(lineQuantities(db, cartId), []);
});

void test('a failing audit append rolls back every line and the cart touch', (t) => {
  const trustedFixture = openFixture('cart-bulk-audit-baseline');
  t.after(trustedFixture.cleanup);
  const [variant] = sellableVariants(trustedFixture.db, 1) as [SellableVariant];
  pin(trustedFixture.db, variant.id, { stock: 1_000, moqSacks: 1, backorderable: 0 });
  const { cartId } = trustedFixture.service.create(CONTEXT);
  const updatedAtBefore = (
    trustedFixture.db.prepare('SELECT updated_at FROM carts WHERE id = ?').get(cartId) as {
      updated_at: string;
    }
  ).updated_at;

  const failing = createCartService(
    trustedFixture.carts,
    {
      unitOfWork: createUnitOfWork(trustedFixture.db),
      audit: {
        append: () => {
          throw new Error('audit unavailable');
        },
      },
    },
    {
      inventory: createInventoryService({
        repository: createInventoryRepository(trustedFixture.db),
      }),
      clock: { now: () => NOW },
    },
  );

  assert.throws(
    () => failing.addMany(cartId, [{ key: 'a', variantId: variant.id, quantity: 4 }], CONTEXT),
    /audit unavailable/,
  );
  assert.deepEqual(lineQuantities(trustedFixture.db, cartId), []);
  assert.equal(
    (
      trustedFixture.db.prepare('SELECT updated_at FROM carts WHERE id = ?').get(cartId) as {
        updated_at: string;
      }
    ).updated_at,
    updatedAtBefore,
  );
});

void test('bulk add demands audit context and availability dependencies', (t) => {
  const fixture = openFixture('cart-bulk-deps');
  t.after(fixture.cleanup);
  const { db, service, carts } = fixture;
  const [variant] = sellableVariants(db, 1) as [SellableVariant];
  const { cartId } = service.create(CONTEXT);
  assert.throws(
    () => service.addMany(cartId, [{ key: 'a', variantId: variant.id, quantity: 4 }]),
    /audit context is required/,
  );
  assert.throws(
    () =>
      createCartService(carts).addMany(
        cartId,
        [{ key: 'a', variantId: variant.id, quantity: 4 }],
        CONTEXT,
      ),
    /audit dependencies are required/,
  );
});
