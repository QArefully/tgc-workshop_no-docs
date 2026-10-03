import assert from 'node:assert/strict';
import test from 'node:test';
import { openDatabase } from '../../src/db/index.js';
import { createUnitOfWork } from '../../src/db/unitOfWork.js';
import { createAuditRepository } from '../../src/features/audit/auditRepository.js';
import { createAuditWriter, type AuditWriter } from '../../src/features/audit/auditService.js';
import { createBundleRepository } from '../../src/features/bundles/bundleRepository.js';
import { createBundleService } from '../../src/features/bundles/bundleService.js';
import {
  createCartRepository,
  type CartRepository,
} from '../../src/features/cart/cartRepository.js';
import { createCart, getCart } from '../../src/features/cart/cartService.js';
import { createInventoryRepository } from '../../src/features/inventory/inventoryRepository.js';
import { createInventoryService } from '../../src/features/inventory/inventoryService.js';
import { validateMoq } from '../../src/features/pricing/pricingRules.js';
import { openSeededDatabase } from '../support/seededDatabase.js';

function defaultVariantId(db: ReturnType<typeof openDatabase>, productId: number): string {
  const row = db
    .prepare(
      'SELECT id FROM product_variants WHERE product_id = ? AND sort_order = 1 AND active = 1 LIMIT 1',
    )
    .get(productId) as { id: number } | undefined;
  if (!row) throw new Error(`No default variant for product ${productId}`);
  return String(row.id);
}

function createFixture(t: test.TestContext, audit?: AuditWriter) {
  const { db } = openSeededDatabase(t);
  const carts = createCartRepository(db);
  const service = createBundleService({
    bundles: createBundleRepository(db),
    carts,
    unitOfWork: createUnitOfWork(db),
    audit:
      audit ??
      createAuditWriter({
        repository: createAuditRepository(db),
        clock: { now: () => new Date('2026-07-18T12:00:00.000Z') },
      }),
  });
  return { db, carts, service };
}

const context = { actor: { type: 'anonymous' as const, userId: null }, requestId: 'bundle-add' };

void test('lists visible bundles with current component prices and deterministic availability', (t) => {
  const { db, service } = createFixture(t);
  const bundles = service.list();
  assert.deepEqual(
    bundles.map((bundle) => bundle.key),
    [
      'protein-starter-pack',
      'baking-essentials',
      'garden-care-kit',
      'cleaning-supplies-bundle',
      'casting-workshop-kit',
      'drinks-sampler',
    ],
  );
  const starter = bundles[0];
  assert.ok(starter);
  const variant8 = defaultVariantId(db, 8);
  db.prepare('UPDATE product_variants SET price_cents = 4321, stock_count = 0 WHERE id = ?').run(
    variant8,
  );
  const refreshed = service.list().find((bundle) => bundle.id === starter.id);
  assert.equal(refreshed?.components[0]?.lineTotalCents, 17_284);
  assert.equal(refreshed?.available, false);
  db.prepare('UPDATE products SET active = 0 WHERE id = 9').run();
  assert.equal(
    service.list().some((bundle) => bundle.id === starter.id),
    false,
  );
  assert.deepEqual(
    service.list('28').map((bundle) => bundle.key),
    ['garden-care-kit'],
  );
});

void test('bundle reads and cart eligibility use available-to-sell, with backorder opt-in permitted', (t) => {
  const { db, carts } = createFixture(t);
  const now = new Date('2026-07-19T12:00:00.000Z');
  const inventory = createInventoryService({ repository: createInventoryRepository(db) });
  const service = createBundleService({
    bundles: createBundleRepository(db),
    carts,
    unitOfWork: createUnitOfWork(db),
    audit: createAuditWriter({
      repository: createAuditRepository(db),
      clock: { now: () => now },
    }),
    availability: { inventory, clock: { now: () => now } },
  });
  const variant8 = defaultVariantId(db, 8);
  db.prepare('UPDATE product_variants SET stock_count = 1 WHERE id = ?').run(variant8);
  db.prepare(
    `INSERT INTO payments
      (idempotency_key, request_fingerprint, status, amount_cents, card_last4, card_brand)
     VALUES ('bundle-availability', 'bundle-availability', 'prepared', 1, '4242', 'Visa')`,
  ).run();
  db.prepare(
    `INSERT INTO inventory_reservations
      (payment_idempotency_key, variant_id, reserved_quantity, backordered_quantity, expires_at, created_at)
     VALUES ('bundle-availability', ?, 1, 0, '2026-07-19T12:01:00.000Z', ?)`,
  ).run(variant8, now.toISOString());
  const starter = service.list().find((bundle) => bundle.id === '1');
  assert.equal(
    starter?.components.find((component) => component.product.id === '8')?.product.stock,
    0,
  );
  const rejected = service.addToCart(createCart(carts).cartId, '1', context);
  if (typeof rejected === 'string' || !('error' in rejected))
    throw new Error('Expected unavailable bundle');
  assert.equal(rejected.error, 'BUNDLE_UNAVAILABLE');

  db.prepare(
    'UPDATE product_variants SET backorderable = 1, backorder_lead_days = 14 WHERE id = ?',
  ).run(variant8);
  const accepted = service.addToCart(createCart(carts).cartId, '1', context);
  assert.equal(typeof accepted, 'object');
  if (typeof accepted === 'string' || !('items' in accepted)) throw new Error('Expected cart');
  assert.equal(
    accepted.items.find((item) => item.productId === '8')?.product.availability,
    'backorder',
  );
});

void test('adds a bundle as ordinary cart lines, increments repeats, and writes one audit fact', (t) => {
  const { db, carts, service } = createFixture(t);
  const { cartId } = createCart(carts);
  const first = service.addToCart(cartId, '1', context);
  assert.equal(typeof first, 'object');
  if (typeof first === 'string' || !('items' in first)) throw new Error('Expected cart');
  assert.deepEqual(
    first.items.map((item) => [item.productId, item.quantity]),
    [
      ['8', 4],
      ['9', 4],
      ['13', 4],
    ],
  );
  assert.ok(
    first.items.every((item) => {
      const variant = db
        .prepare('SELECT weight_grams, moq_sacks FROM product_variants WHERE id = ?')
        .get(item.variantSnap?.variantId) as
        { weight_grams: number; moq_sacks: number } | undefined;
      return (
        variant !== undefined && validateMoq(item.quantity, variant.weight_grams, variant.moq_sacks)
      );
    }),
    'every bundle cart line must meet the checkout MOQ predicate',
  );
  assert.notEqual(service.addToCart(cartId, '1', context), 'BUNDLE_NOT_FOUND');
  assert.deepEqual(
    getCart(carts, cartId)?.items.map((item) => [item.productId, item.quantity]),
    [
      ['8', 8],
      ['9', 8],
      ['13', 8],
    ],
  );
  const events = db
    .prepare('SELECT action, metadata_json FROM audit_events ORDER BY id')
    .all() as Array<{ action: string; metadata_json: string }>;
  assert.deepEqual(events, [
    {
      action: 'cart.bundle_added',
      metadata_json: '{"bundleId":1,"componentCount":3,"quantity":12}',
    },
    {
      action: 'cart.bundle_added',
      metadata_json: '{"bundleId":1,"componentCount":3,"quantity":12}',
    },
  ]);
});

void test('rejects every unavailable component without touching ordinary cart lines or audit', (t) => {
  const { db, carts, service } = createFixture(t);
  const variant8 = defaultVariantId(db, 8);
  const variant13 = defaultVariantId(db, 13);
  const { cartId } = createCart(carts);
  carts.addLineQuantity(cartId, variant8, 2);
  db.prepare('UPDATE product_variants SET stock_count = 2 WHERE id = ?').run(variant8);
  db.prepare('UPDATE product_variants SET active = 0 WHERE id = ?').run(variant13);
  const result = service.addToCart(cartId, '1', context);
  assert.equal(typeof result, 'object');
  if (typeof result === 'string' || !('error' in result))
    throw new Error('Expected unavailable bundle');
  const sortedVariantIds = result.variantIds.sort((a, b) => Number(a) - Number(b));
  const expected = [variant8, variant13].map(String).sort((a, b) => Number(a) - Number(b));
  assert.deepEqual(sortedVariantIds, expected);
  assert.equal(carts.lineQuantity(cartId, variant8), 2);
  assert.equal(carts.lineQuantity(cartId, defaultVariantId(db, 9)), 0);
  assert.equal(carts.lineQuantity(cartId, variant13), 0);
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM audit_events').get() as { count: number }).count,
    0,
  );
});

void test('rolls back all component writes and cart touch when audit append fails', (t) => {
  const failingAudit: AuditWriter = {
    append: () => {
      throw new Error('audit unavailable');
    },
  };
  const { carts, service } = createFixture(t, failingAudit);
  const { cartId } = createCart(carts);
  const before = getCart(carts, cartId)?.items;
  assert.deepEqual(before, []);
  assert.throws(() => service.addToCart(cartId, '1', context), /audit unavailable/);
  assert.deepEqual(getCart(carts, cartId)?.items, []);
});

void test('rolls back prior component writes when a later component write fails', (t) => {
  const { db, carts } = createFixture(t);
  const { cartId } = createCart(carts);
  let writes = 0;
  const failingCarts: CartRepository = {
    ...carts,
    addLineQuantity(id, variantId, quantity) {
      writes += 1;
      if (writes === 2) throw new Error('component write failed');
      carts.addLineQuantity(id, variantId, quantity);
    },
  };
  const service = createBundleService({
    bundles: createBundleRepository(db),
    carts: failingCarts,
    unitOfWork: createUnitOfWork(db),
    audit: createAuditWriter({
      repository: createAuditRepository(db),
      clock: { now: () => new Date('2026-07-18T12:00:00.000Z') },
    }),
  });

  assert.throws(() => service.addToCart(cartId, '1', context), /component write failed/);
  assert.deepEqual(getCart(carts, cartId)?.items, []);
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM audit_events').get() as { count: number }).count,
    0,
  );
});
