import assert from 'node:assert/strict';
import test from 'node:test';
import { Cart, CreateCartResponse } from '@shop/contracts/cart';
import { Value } from '@sinclair/typebox/value';
import { openDatabase } from '../../src/db/index.js';
import { createSeededAppFixture, openSeededDatabase } from '../support/seededDatabase.js';
import { createCartRepository } from '../../src/features/cart/cartRepository.js';
import {
  addItem,
  createCart,
  createCartService,
  getCart,
  removeItem,
  updateItem,
} from '../../src/features/cart/cartService.js';
import { createUnitOfWork } from '../../src/db/unitOfWork.js';
import { createPromoRepository } from '../../src/features/promos/promoRepository.js';
import { validatePromo } from '../../src/features/promos/promoService.js';
import { createAuditRepository } from '../../src/features/audit/auditRepository.js';
import { createAuditWriter, type AuditWriter } from '../../src/features/audit/auditService.js';
import { createInventoryRepository } from '../../src/features/inventory/inventoryRepository.js';
import { createInventoryService } from '../../src/features/inventory/inventoryService.js';
import { perTonneCents, resolveUnitPriceCents } from '../../src/features/pricing/pricingRules.js';
import { SACKS_PER_PALLET } from '@shop/contracts/pricing';

function defaultVariantId(db: ReturnType<typeof openDatabase>, productId: number): string {
  const row = db
    .prepare(
      'SELECT id FROM product_variants WHERE product_id = ? AND sort_order = 1 AND active = 1 LIMIT 1',
    )
    .get(productId) as { id: number } | undefined;
  if (!row) throw new Error(`No default variant for product ${productId}`);
  return String(row.id);
}

function responseStatusCode(response: unknown): number {
  if (typeof response !== 'object' || response === null || !('statusCode' in response)) {
    throw new Error('Expected an injected HTTP response');
  }
  const { statusCode } = response;
  if (typeof statusCode !== 'number') throw new Error('Expected a numeric HTTP status code');
  return statusCode;
}

void test('cart service coordinates cart repository and promo eligibility', (t) => {
  const { db } = openSeededDatabase(t);
  const carts = createCartRepository(db);
  const variant1 = defaultVariantId(db, 1);
  const { cartId } = createCart(carts);
  assert.equal(addItem(carts, cartId, variant1).id, cartId);
  assert.equal(updateItem(carts, cartId, variant1, 4).totalItems, 4);
  assert.equal(
    validatePromo(
      { code: 'SAVE10', cartId, userId: null, now: new Date('2026-07-14T10:00:00.000Z') },
      { carts, promos: createPromoRepository(db) },
    ).errorCode,
    'MIN_ITEMS',
  );
  assert.equal(removeItem(carts, cartId, variant1).totalItems, 0);
  assert.deepEqual(getCart(carts, cartId)?.items, []);
});

void test('cart blocks new inactive selections but retains existing lines', (t) => {
  const { db } = openSeededDatabase(t);
  const carts = createCartRepository(db);
  const variant1 = defaultVariantId(db, 1);
  const { cartId } = createCart(carts);
  assert.notEqual(addItem(carts, cartId, variant1), 'VARIANT_NOT_FOUND');
  db.prepare('UPDATE product_variants SET active = 0 WHERE id = ?').run(variant1);
  assert.equal(addItem(carts, cartId, variant1), 'VARIANT_NOT_FOUND');
  assert.equal(getCart(carts, cartId)?.items[0]?.productId, '1');
});

void test('cart transports server-resolved default and discounted-tier prices', (t) => {
  const { db } = openSeededDatabase(t);
  const carts = createCartRepository(db);
  const variant = db
    .prepare(
      `SELECT id, price_cents, weight_grams
       FROM product_variants WHERE active = 1 ORDER BY id LIMIT 1`,
    )
    .get() as { id: number; price_cents: number; weight_grams: number };
  const defaultCartId = createCart(carts).cartId;
  carts.addLineQuantity(defaultCartId, String(variant.id), 1);
  const defaultLine = getCart(carts, defaultCartId)?.items[0];
  assert.equal(defaultLine?.resolvedUnitPriceCents, variant.price_cents);
  assert.equal(
    defaultLine?.perTonneCents,
    perTonneCents(variant.price_cents, variant.weight_grams),
  );
  assert.equal(defaultLine?.lineTotalCents, variant.price_cents);

  const quantity = Math.ceil(5_000_000 / variant.weight_grams);
  const discountedCartId = createCart(carts).cartId;
  carts.addLineQuantity(discountedCartId, String(variant.id), quantity);
  const cart = getCart(carts, discountedCartId);
  const unitPriceCents = resolveUnitPriceCents(variant.price_cents, quantity, variant.weight_grams);
  assert.ok(unitPriceCents < variant.price_cents);
  assert.equal(cart?.items[0]?.resolvedUnitPriceCents, unitPriceCents);
  assert.equal(
    cart?.items[0]?.perTonneCents,
    perTonneCents(variant.price_cents, variant.weight_grams),
  );
  assert.equal(cart?.items[0]?.lineTotalCents, unitPriceCents * quantity);
  assert.equal(cart?.subtotalCents, unitPriceCents * quantity);
});

void test('cart applies only active clearance as the common tier and per-tonne base', (t) => {
  const { db } = openSeededDatabase(t);

  const now = new Date('2026-07-28T12:00:00.000Z');
  const carts = createCartRepository(db);
  const inventory = createInventoryService({ repository: createInventoryRepository(db) });
  const service = createCartService(carts, undefined, { inventory, clock: { now: () => now } });
  const variant = db
    .prepare(
      `SELECT id, price_cents, weight_grams
       FROM product_variants WHERE sku = 'GDN-1043-001'`,
    )
    .get() as { id: number; price_cents: number; weight_grams: number };
  const quantity = Math.ceil(5_000_000 / variant.weight_grams);
  const cartId = createCart(carts).cartId;
  carts.addLineQuantity(cartId, String(variant.id), quantity);

  const line = service.get(cartId)?.items[0];
  const clearanceBaseCents = 24_000;
  assert.deepEqual(line?.clearance, {
    priceCents: clearanceBaseCents,
    perTonneCents: perTonneCents(clearanceBaseCents, variant.weight_grams),
    startsAt: '2026-07-21T12:00:00.000Z',
    endsAt: '2026-08-04T12:00:00.000Z',
  });
  assert.equal(line?.perTonneCents, perTonneCents(clearanceBaseCents, variant.weight_grams));
  assert.equal(
    line?.resolvedUnitPriceCents,
    resolveUnitPriceCents(clearanceBaseCents, quantity, variant.weight_grams),
  );
  assert.equal(line?.materialSubtotalCents, line?.resolvedUnitPriceCents * quantity);
  assert.equal(line?.discountableTotalCents, line?.materialSubtotalCents);
  assert.equal(line?.lineTotalCents, line?.materialSubtotalCents);

  db.prepare(
    `UPDATE product_variants
     SET clearance_ends_at = '2026-07-28T12:00:00.000Z'
     WHERE id = ?`,
  ).run(variant.id);
  const inactiveLine = service.get(cartId)?.items[0];
  assert.equal(inactiveLine?.clearance, undefined);
  assert.equal(
    inactiveLine?.perTonneCents,
    perTonneCents(variant.price_cents, variant.weight_grams),
  );
  assert.equal(
    inactiveLine?.resolvedUnitPriceCents,
    resolveUnitPriceCents(variant.price_cents, quantity, variant.weight_grams),
  );
});

void test('cart publishes server-resolved next-tier progress through the top tier', (t) => {
  const { db } = openSeededDatabase(t);

  const carts = createCartRepository(db);
  const variant = db
    .prepare(
      `SELECT id, weight_grams FROM product_variants
       WHERE active = 1 AND weight_grams = 25000 ORDER BY id LIMIT 1`,
    )
    .get() as { id: number; weight_grams: number } | undefined;
  if (!variant) throw new Error('Expected an active 25kg variant');
  const cartId = createCart(carts).cartId;
  carts.addLineQuantity(cartId, String(variant.id), SACKS_PER_PALLET - 1);

  const oneSackBelow = getCart(carts, cartId)?.items[0]?.nextTierProgress;
  assert.deepEqual(oneSackBelow, {
    minTonnes: 1,
    discountPct: 0,
    sacksToNextTier: 1,
    weightToNextTierGrams: variant.weight_grams,
  });

  carts.updateLine(cartId, String(variant.id), SACKS_PER_PALLET * 10);
  assert.equal(getCart(carts, cartId)?.items[0]?.nextTierProgress, undefined);
});

void test('cart reads batch available-to-sell and ignores only expired prepared locks', (t) => {
  const { db } = openSeededDatabase(t);
  const now = new Date('2026-07-19T12:00:00.000Z');
  const carts = createCartRepository(db);
  const variant1 = defaultVariantId(db, 1);
  const variant2 = defaultVariantId(db, 2);
  const variant3 = defaultVariantId(db, 3);
  const inventory = createInventoryService({ repository: createInventoryRepository(db) });
  const service = createCartService(carts, undefined, {
    inventory,
    clock: { now: () => now },
  });
  const cartId = createCart(carts).cartId;
  carts.addLine(cartId, variant1);
  db.prepare('UPDATE product_variants SET stock_count = 1 WHERE id = ?').run(variant1);
  db.prepare(
    `INSERT INTO payments
      (idempotency_key, request_fingerprint, status, amount_cents, card_last4, card_brand)
     VALUES ('cart-availability', 'cart-availability', 'prepared', 1, '4242', 'Visa')`,
  ).run();
  db.prepare(
    `INSERT INTO inventory_reservations
      (payment_idempotency_key, variant_id, reserved_quantity, backordered_quantity, expires_at, created_at)
     VALUES ('cart-availability', ?, 1, 0, '2026-07-19T12:01:00.000Z', ?)`,
  ).run(variant1, now.toISOString());
  assert.equal(service.get(cartId)?.items[0]?.product.stock, 0);
  assert.equal(service.get(cartId)?.items[0]?.product.availability, 'out_of_stock');

  const expiredKey = 'cart-expired-lock';
  db.prepare(
    `INSERT INTO payments
      (idempotency_key, request_fingerprint, status, amount_cents, card_last4, card_brand, reservation_expires_at)
     VALUES (?, ?, 'prepared', 1, '4242', 'Visa', '2026-07-19T12:00:00.000Z')`,
  ).run(expiredKey, expiredKey);
  carts.reserve(cartId, expiredKey, now.toISOString());
  assert.notEqual(service.add(cartId, variant2), 'CART_RESERVED');

  carts.releaseReservation(expiredKey);
  const authorizedKey = 'cart-authorized-lock';
  db.prepare(
    `INSERT INTO payments
      (idempotency_key, request_fingerprint, status, amount_cents, card_last4, card_brand, reservation_expires_at)
     VALUES (?, ?, 'authorized_pending_finalize', 1, '4242', 'Visa', '2026-07-19T11:00:00.000Z')`,
  ).run(authorizedKey, authorizedKey);
  carts.reserve(cartId, authorizedKey, now.toISOString());
  assert.equal(service.add(cartId, variant3), 'CART_RESERVED');
});

void test('cart HTTP response returns product lines with a server-quoted delivery preview', async (t) => {
  const { db, app } = await createSeededAppFixture(t);
  const created = await app.inject({ method: 'POST', url: '/api/cart' });
  const cartId = Value.Parse(CreateCartResponse, created.json()).cartId;
  db.prepare(
    "UPDATE product_variants SET delivery_class = 'parcel', weight_grams = 100000, moq_sacks = 1 WHERE id = 6",
  ).run();
  const product = await app.inject({
    method: 'POST',
    url: `/api/cart/${cartId}/items`,
    payload: { productId: '3', variantId: 6 },
  });
  assert.equal(product.statusCode, 200);
  const cart = Value.Parse(Cart, product.json());
  assert.equal(cart.items.length, 1);
  assert.equal(cart.totalItems, 1);
  assert.equal(cart.subtotalCents, cart.items[0].lineTotalCents);
  assert.deepEqual(cart.deliveryPreview, {
    mode: 'freight',
    chargeCents: 999,
    weightGrams: 100_000,
    reason: 'Total weight 100000g meets or exceeds 100000g freight threshold',
  });
});

void test('cart HTTP enforces MOQ and defaults omitted add quantity to its floor', async (t) => {
  const { db, app } = await createSeededAppFixture(t);

  const variant = db
    .prepare(
      `SELECT v.id, v.product_id, v.weight_grams, v.moq_sacks
       FROM product_variants v WHERE v.active = 1 ORDER BY v.id LIMIT 1`,
    )
    .get() as { id: number; product_id: number; weight_grams: number; moq_sacks: number };
  const minimumQuantity = Math.ceil((variant.moq_sacks * 25_000) / variant.weight_grams);
  const create = await app.inject({ method: 'POST', url: '/api/cart' });
  const cartId = Value.Parse(CreateCartResponse, create.json()).cartId;

  const added = await app.inject({
    method: 'POST',
    url: `/api/cart/${cartId}/items`,
    payload: { productId: String(variant.product_id), variantId: variant.id },
  });
  assert.equal(added.statusCode, 200);
  const cart = Value.Parse(Cart, added.json());
  assert.equal(cart.items[0]?.quantity, minimumQuantity);

  const below = await app.inject({
    method: 'PATCH',
    url: `/api/cart/${cartId}/items`,
    payload: { productId: String(variant.product_id), quantity: minimumQuantity - 1 },
  });
  assert.equal(below.statusCode, 400);
  assert.deepEqual(below.json(), {
    code: 'BELOW_MOQ',
    error: `Quantity must be at least ${minimumQuantity}.`,
    meta: { minQuantity: minimumQuantity },
  });
});

void test('cart HTTP resolves omitted variant to the product default when variants are ambiguous', async (t) => {
  const { db, app } = await createSeededAppFixture(t);

  const product = db
    .prepare(
      `SELECT p.id AS product_id, p.default_variant_id
       FROM products p
       INNER JOIN product_variants v ON v.product_id = p.id AND v.active = 1
       WHERE p.active = 1 AND p.default_variant_id IS NOT NULL
       GROUP BY p.id
       HAVING COUNT(v.id) > 1
       ORDER BY p.id LIMIT 1`,
    )
    .get() as { product_id: number; default_variant_id: number | null } | undefined;
  if (!product || product.default_variant_id === null) {
    throw new Error('Expected an active product with multiple variants and a default variant');
  }

  const create = await app.inject({ method: 'POST', url: '/api/cart' });
  const cartId = Value.Parse(CreateCartResponse, create.json()).cartId;
  const added = await app.inject({
    method: 'POST',
    url: `/api/cart/${cartId}/items`,
    payload: { productId: String(product.product_id) },
  });

  assert.equal(added.statusCode, 200);
  const cart = Value.Parse(Cart, added.json());
  assert.equal(cart.items.length, 1);
  assert.equal(cart.items[0]?.productId, String(product.product_id));
  assert.equal(cart.items[0]?.variantSnap?.variantId, product.default_variant_id);
});

void test('cart HTTP validates quantities and targets exact variant cart lines', async (t) => {
  const { db, app } = await createSeededAppFixture(t);

  const variants = db
    .prepare<[], { id: number; product_id: number; weight_grams: number; moq_sacks: number }>(
      `SELECT v.id, v.product_id, v.weight_grams, v.moq_sacks
       FROM product_variants v
       WHERE v.active = 1
         AND v.product_id = (
           SELECT product_id FROM product_variants WHERE active = 1
           GROUP BY product_id HAVING COUNT(*) > 1 ORDER BY product_id LIMIT 1
         )
       ORDER BY v.sort_order LIMIT 2`,
    )
    .all();
  assert.equal(variants.length, 2);
  const [first, second] = variants;
  if (!first || !second) throw new Error('Expected two active variants');
  const firstMinimum = Math.ceil((first.moq_sacks * 25_000) / first.weight_grams);
  const secondMinimum = Math.ceil((second.moq_sacks * 25_000) / second.weight_grams);
  const create = await app.inject({ method: 'POST', url: '/api/cart' });
  const cartId = Value.Parse(CreateCartResponse, create.json()).cartId;

  for (const variant of variants) {
    const minimum = variant.id === first.id ? firstMinimum : secondMinimum;
    const added = await app.inject({
      method: 'POST',
      url: `/api/cart/${cartId}/items`,
      payload: {
        productId: String(variant.product_id),
        variantId: variant.id,
        quantity: Number(minimum),
      },
    });
    assert.equal(responseStatusCode(added), 200);
  }

  for (const payload of [
    { productId: String(first.product_id), variantId: first.id, quantity: Number.MAX_SAFE_INTEGER },
    {
      productId: String(first.product_id),
      variantId: first.id,
      quantity: Number.MAX_SAFE_INTEGER + 1,
    },
    { productId: String(first.product_id), variantId: first.id, quantity: 1.5 },
  ]) {
    const response = await app.inject({
      method: 'POST',
      url: `/api/cart/${cartId}/items`,
      payload,
    });
    assert.equal(responseStatusCode(response), 400);
  }
  for (const quantity of [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, 1.5]) {
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/cart/${cartId}/items`,
      payload: { productId: String(first.product_id), variantId: first.id, quantity },
    });
    assert.equal(responseStatusCode(response), 400);
  }

  const ambiguousUpdate = await app.inject({
    method: 'PATCH',
    url: `/api/cart/${cartId}/items`,
    payload: { productId: String(first.product_id), quantity: firstMinimum },
  });
  assert.equal(ambiguousUpdate.statusCode, 400);
  const ambiguousRemove = await app.inject({
    method: 'DELETE',
    url: `/api/cart/${cartId}/items/${first.product_id}`,
  });
  assert.equal(ambiguousRemove.statusCode, 400);

  const updated = await app.inject({
    method: 'PATCH',
    url: `/api/cart/${cartId}/items`,
    payload: {
      productId: String(first.product_id),
      variantId: first.id,
      quantity: firstMinimum + 1,
    },
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(
    Value.Parse(Cart, updated.json()).items.find((item) => item.variantSnap?.variantId === first.id)
      ?.quantity,
    firstMinimum + 1,
  );

  const removed = await app.inject({
    method: 'DELETE',
    url: `/api/cart/${cartId}/items/${first.product_id}`,
    payload: { productId: String(first.product_id), variantId: second.id },
  });
  assert.equal(removed.statusCode, 200);
  const remaining = Value.Parse(Cart, removed.json()).items;
  assert.deepEqual(
    remaining.map((item) => item.variantSnap?.variantId),
    [first.id],
  );
});

void test('audited cart mutations emit one allowlisted event per committed change', (t) => {
  const { db } = openSeededDatabase(t);

  const carts = createCartRepository(db);
  const variant1 = defaultVariantId(db, 1);
  const writer = createAuditWriter({
    repository: createAuditRepository(db),
    clock: { now: () => new Date('2026-07-18T12:00:00.000Z') },
  });
  const service = createCartService(carts, {
    unitOfWork: createUnitOfWork(db),
    audit: writer,
  });
  const anonymous = { actor: { type: 'anonymous' as const, userId: null }, requestId: 'cart-a' };
  const user = { actor: { type: 'user' as const, userId: 12 }, requestId: 'cart-b' };

  const { cartId } = service.create(anonymous);
  assert.notEqual(service.add(cartId, variant1, user), 'CART_NOT_FOUND');
  assert.notEqual(service.update(cartId, variant1, 4, user), 'CART_NOT_FOUND');
  assert.notEqual(service.update(cartId, variant1, 0, user), 'CART_NOT_FOUND');
  assert.equal(service.update(cartId, variant1, 2, user), 'VARIANT_NOT_IN_CART');

  const events = db
    .prepare(
      `SELECT actor_type, actor_user_id, action, entity_id, request_id, metadata_json
       FROM audit_events ORDER BY id`,
    )
    .all() as Array<{
    actor_type: string;
    actor_user_id: number | null;
    action: string;
    entity_id: string;
    request_id: string;
    metadata_json: string;
  }>;
  assert.deepEqual(
    events.map(({ action, actor_type, actor_user_id, entity_id, request_id, metadata_json }) => ({
      action,
      actor_type,
      actor_user_id,
      entity_id,
      request_id,
      metadata_json,
    })),
    [
      {
        action: 'cart.created',
        actor_type: 'anonymous',
        actor_user_id: null,
        entity_id: cartId,
        request_id: 'cart-a',
        metadata_json: '{}',
      },
      {
        action: 'cart.product_added',
        actor_type: 'user',
        actor_user_id: 12,
        entity_id: cartId,
        request_id: 'cart-b',
        metadata_json: JSON.stringify({ productId: Number(variant1), quantity: 4 }),
      },
      {
        action: 'cart.product_quantity_changed',
        actor_type: 'user',
        actor_user_id: 12,
        entity_id: cartId,
        request_id: 'cart-b',
        metadata_json: JSON.stringify({ productId: Number(variant1), quantity: 4 }),
      },
      {
        action: 'cart.product_removed',
        actor_type: 'user',
        actor_user_id: 12,
        entity_id: cartId,
        request_id: 'cart-b',
        metadata_json: JSON.stringify({ productId: Number(variant1) }),
      },
    ],
  );
});

void test('cart audit failure rolls back mutation and cart touch transaction', (t) => {
  const { db } = openSeededDatabase(t);

  const carts = createCartRepository(db);
  const variant1 = defaultVariantId(db, 1);
  const failingAudit: AuditWriter = {
    append: () => {
      throw new Error('audit unavailable');
    },
  };
  const service = createCartService(carts, {
    unitOfWork: createUnitOfWork(db),
    audit: failingAudit,
  });
  const context = { actor: { type: 'anonymous' as const, userId: null }, requestId: 'cart-fail' };

  // The canonical seed owns carts of its own, so the rollback is measured as a delta.
  const cartsBefore = (db.prepare('SELECT COUNT(*) AS count FROM carts').get() as { count: number })
    .count;
  assert.throws(() => service.create(context), /audit unavailable/);
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM carts').get() as { count: number }).count,
    cartsBefore,
  );

  const { cartId } = createCart(carts);
  assert.throws(() => service.add(cartId, variant1, context), /audit unavailable/);
  assert.deepEqual(getCart(carts, cartId)?.items, []);
});
