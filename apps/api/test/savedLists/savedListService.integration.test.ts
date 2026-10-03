import assert from 'node:assert/strict';
import test from 'node:test';
import { createUnitOfWork } from '../../src/db/unitOfWork.js';
import { createAuditRepository } from '../../src/features/audit/auditRepository.js';
import { createAuditWriter } from '../../src/features/audit/auditService.js';
import { createCartRepository } from '../../src/features/cart/cartRepository.js';
import { createCartService } from '../../src/features/cart/cartService.js';
import { createProductRepository } from '../../src/features/catalog/productRepository.js';
import { createInventoryRepository } from '../../src/features/inventory/inventoryRepository.js';
import { createInventoryService } from '../../src/features/inventory/inventoryService.js';
import { createOrderRepository } from '../../src/features/orders/orderRepository.js';
import { createOrderService } from '../../src/features/orders/orderService.js';
import { createSavedListRepository } from '../../src/features/savedLists/savedListRepository.js';
import { createSavedListService } from '../../src/features/savedLists/savedListService.js';
import { openSeededDatabase } from '../support/seededDatabase.js';

const now = new Date('2026-01-15T12:00:00.000Z');
const context = { actor: { type: 'user' as const, userId: 1 }, requestId: 'saved-list-test' };

function fixture(t: test.TestContext) {
  const { db } = openSeededDatabase(t);
  const clock = { now: () => now };
  const unitOfWork = createUnitOfWork(db);
  const inventory = createInventoryService({ repository: createInventoryRepository(db) });
  const carts = createCartService(
    createCartRepository(db),
    { unitOfWork, audit: createAuditWriter({ repository: createAuditRepository(db), clock }) },
    { inventory, clock },
  );
  const repository = createSavedListRepository(db);
  const service = createSavedListService({
    repository,
    variants: createProductRepository(db),
    inventory,
    carts,
    orders: createOrderService(createOrderRepository(db)),
    unitOfWork,
    audit: createAuditWriter({ repository: createAuditRepository(db), clock }),
    clock,
  });
  const activeVariants = db
    .prepare('SELECT id FROM product_variants WHERE active = 1 ORDER BY id LIMIT 4')
    .all() as Array<{ id: number }>;
  assert.equal(activeVariants.length, 4);
  return { db, repository, service, carts, inventory, activeVariants };
}

function value<T>(result: { ok: true; value: T } | { ok: false; code: string }): T {
  assert.equal(result.ok, true, result.ok ? '' : result.code);
  return result.value;
}

void test('SQLite service enforces ownership, names, default policy, and the list cap before inserting', (t) => {
  const { service } = fixture(t);
  const created = value(service.create(2, '  Monthly   restock ', context));
  assert.equal(created.name, 'Monthly restock');
  assert.deepEqual(service.rename(1, Number(created.listId), 'Other', context), {
    ok: false,
    code: 'LIST_NOT_FOUND',
  });
  const duplicateTarget = value(service.create(2, 'Second list', context));
  assert.deepEqual(service.rename(2, Number(duplicateTarget.listId), 'monthly RESTOCK', context), {
    ok: false,
    code: 'NAME_TAKEN',
  });
  assert.deepEqual(service.delete(1, Number(created.listId), context), {
    ok: false,
    code: 'LIST_NOT_FOUND',
  });
  assert.equal(service.delete(2, Number(created.listId), context).ok, true);

  const defaultList = value(service.getOrCreateDefault(2, context));
  assert.equal(value(service.getOrCreateDefault(2, context)).listId, defaultList.listId);
  assert.equal(
    value(service.rename(2, Number(defaultList.listId), 'Pinned materials', context)).name,
    'Pinned materials',
  );
  assert.deepEqual(service.delete(2, Number(defaultList.listId), context), {
    ok: false,
    code: 'DEFAULT_LIST_IMMUTABLE',
  });

  for (let index = 0; index < 25; index += 1)
    assert.equal(service.create(3, `List ${index}`, context).ok, true);
  assert.deepEqual(service.getOrCreateDefault(3, context), {
    ok: false,
    code: 'LIST_LIMIT_REACHED',
  });
});

void test('lazy default maps a case-insensitive Favourites collision to NAME_TAKEN', (t) => {
  const { service } = fixture(t);
  assert.equal(service.create(2, ' favourites ', context).ok, true);
  assert.deepEqual(service.getOrCreateDefault(2, context), { ok: false, code: 'NAME_TAKEN' });
});

void test('SQLite service lists saved lists by default and name with aggregate item counts', (t) => {
  const { db, service, activeVariants } = fixture(t);
  const userId = 2;
  db.prepare('DELETE FROM saved_lists WHERE user_id = ?').run(userId);
  const zulu = value(service.create(userId, 'Zulu', context));
  const alpha = value(service.create(userId, 'Alpha', context));
  const favourites = value(service.getOrCreateDefault(userId, context));
  value(service.addItem(userId, Number(alpha.listId), activeVariants[0].id, 4, context));

  const lists = service.list(userId);
  assert.deepEqual(
    lists.map(({ name }) => name),
    [favourites.name, alpha.name, zulu.name],
  );
  assert.equal(lists.find(({ listId }) => listId === alpha.listId)?.itemCount, 1);
});

void test('items are upserted and repository lists newest created item first with an id tie-breaker', (t) => {
  const { repository, service, activeVariants } = fixture(t);
  const list = value(service.create(2, 'Order check', context));
  assert.equal(service.addItem(2, Number(list.listId), activeVariants[0].id, 4, context).ok, true);
  assert.equal(service.addItem(2, Number(list.listId), activeVariants[0].id, 9, context).ok, true);
  assert.equal(value(service.get(2, Number(list.listId))).items.length, 1);
  assert.equal(value(service.get(2, Number(list.listId))).items[0].quantity, 9);
  repository.insertItem({
    listId: Number(list.listId),
    variantId: activeVariants[1].id,
    quantity: 4,
    now: '2026-01-14T00:00:00.000Z',
  });
  repository.insertItem({
    listId: Number(list.listId),
    variantId: activeVariants[2].id,
    quantity: 4,
    now: '2026-01-15T00:00:00.000Z',
  });
  repository.insertItem({
    listId: Number(list.listId),
    variantId: activeVariants[3].id,
    quantity: 4,
    now: '2026-01-15T00:00:00.000Z',
  });
  assert.deepEqual(
    repository.listItems(2, Number(list.listId)).map((item) => item.variant_id),
    [activeVariants[0].id, activeVariants[3].id, activeVariants[2].id, activeVariants[1].id],
  );
});

void test('reads apply current clearance then tier price and reservation-aware inventory availability', (t) => {
  const { db, service, inventory, activeVariants } = fixture(t);
  const variantId = activeVariants[0].id;
  db.prepare(
    `UPDATE product_variants SET price_cents = 1000, clearance_price_cents = 800, clearance_starts_at = ?, clearance_ends_at = ?, stock_count = 10, backorderable = 0 WHERE id = ?`,
  ).run('2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z', variantId);
  const list = value(service.create(2, 'Live facts', context));
  value(service.addItem(2, Number(list.listId), variantId, 200, context));
  const before = value(service.get(2, Number(list.listId))).items[0];
  assert.equal(before.unitPriceCents, 760);
  assert.equal(before.availableToSell, true);
  db.prepare(
    `INSERT INTO payments (idempotency_key, request_fingerprint, status, amount_cents, card_last4, card_brand, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'saved-list-reservation',
    'saved-list-test',
    'prepared',
    1,
    '1111',
    'Visa',
    now.toISOString(),
  );
  inventory.reserveCheckout({
    paymentIdempotencyKey: 'saved-list-reservation',
    demands: [{ variantId, quantity: 10 }],
    now: now.toISOString(),
    expiresAt: '2026-02-01T00:00:00.000Z',
  });
  assert.equal(value(service.get(2, Number(list.listId))).items[0].availableToSell, false);
});

void test('add-to-cart produces a real mixed SQLite result and preserves cart atomic rejections', (t) => {
  const { db, service, carts, activeVariants } = fixture(t);
  const [added, retired, insufficient, adjusted] = activeVariants;
  db.prepare('UPDATE product_variants SET stock_count = 100, backorderable = 0 WHERE id = ?').run(
    added.id,
  );
  db.prepare('UPDATE product_variants SET active = 0 WHERE id = ?').run(retired.id);
  db.prepare('UPDATE product_variants SET stock_count = 0, backorderable = 0 WHERE id = ?').run(
    insufficient.id,
  );
  db.prepare(
    'UPDATE product_variants SET stock_count = 100, backorderable = 0, weight_grams = 25000, moq_sacks = 4 WHERE id = ?',
  ).run(adjusted.id);
  const list = value(service.create(2, 'Cart report', context));
  for (const [variantId, quantity] of [
    [added.id, 4],
    [retired.id, 4],
    [insufficient.id, 4],
    [adjusted.id, 1],
  ] as const)
    value(service.addItem(2, Number(list.listId), variantId, quantity, context));
  const cartId = carts.create(context).cartId;
  const report = value(service.addToCart(2, Number(list.listId), cartId, context));
  assert.deepEqual(
    report.outcomes.map((outcome) => [
      outcome.variantId,
      outcome.status,
      outcome.reason,
      outcome.moqAdjusted,
    ]),
    [
      [adjusted.id, 'added', null, true],
      [insufficient.id, 'skipped', 'INSUFFICIENT_STOCK', false],
      [retired.id, 'skipped', 'VARIANT_RETIRED', false],
      [added.id, 'added', null, false],
    ],
  );
  const reservedCartId = carts.create(context).cartId;
  db.prepare(
    `INSERT INTO payments (idempotency_key, request_fingerprint, status, amount_cents, card_last4, card_brand, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'saved-list-cart-reservation',
    'saved-list-cart-test',
    'prepared',
    1,
    '1111',
    'Visa',
    now.toISOString(),
  );
  db.prepare(
    'INSERT INTO cart_reservations (cart_id, payment_idempotency_key, created_at) VALUES (?, ?, ?)',
  ).run(reservedCartId, 'saved-list-cart-reservation', now.toISOString());
  assert.deepEqual(service.addToCart(2, Number(list.listId), reservedCartId, context), {
    ok: false,
    code: 'CART_RESERVED',
  });
  assert.deepEqual(
    service.addToCart(2, Number(list.listId), '00000000-0000-4000-8000-000000000000', context),
    { ok: false, code: 'CART_NOT_FOUND' },
  );
});

void test('create-from-cart and create-from-order use real persistence ownership gates', (t) => {
  const { db, service, carts } = fixture(t);
  const emptyCartId = carts.create(context).cartId;
  assert.deepEqual(service.createFromCart(2, emptyCartId, 'Empty', context), {
    ok: false,
    code: 'CART_EMPTY',
  });
  const foreignOrderId = db
    .prepare('SELECT id FROM orders WHERE user_id <> 2 ORDER BY id LIMIT 1')
    .pluck()
    .get() as number;
  assert.deepEqual(service.createFromOrder(2, foreignOrderId, 'Foreign', context), {
    ok: false,
    code: 'ORDER_NOT_FOUND',
  });
});
