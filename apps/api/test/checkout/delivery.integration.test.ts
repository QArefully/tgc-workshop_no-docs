import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCheckoutService,
  type CheckoutParams,
} from '../../src/features/checkout/checkoutService.js';
import { createCartRepository } from '../../src/features/cart/cartRepository.js';
import { addItem, createCart, getCart } from '../../src/features/cart/cartService.js';
import { createPromoRepository } from '../../src/features/promos/promoRepository.js';
import { createPaymentRepository } from '../../src/features/payments/paymentRepository.js';
import { createOrderRepository } from '../../src/features/orders/orderRepository.js';
import { createMailboxRepository } from '../../src/features/mailbox/mailboxRepository.js';
import { createUnitOfWork } from '../../src/db/unitOfWork.js';
import { simulatedPaymentGateway } from '../../src/features/payments/paymentGateway.js';
import { createProductRepository } from '../../src/features/catalog/productRepository.js';
import { createAuditRepository } from '../../src/features/audit/auditRepository.js';
import { createAuditWriter } from '../../src/features/audit/auditService.js';
import { createInventoryRepository } from '../../src/features/inventory/inventoryRepository.js';
import { createInventoryService } from '../../src/features/inventory/inventoryService.js';
import {
  adhocBilling,
  adhocDestination,
  bookableSlot,
  checkoutDepthDependencies,
} from './checkoutDepthFixtures.js';
import { openSeededDatabase } from '../support/seededDatabase.js';

function checkoutService(db: import('better-sqlite3').Database, now?: () => Date) {
  const carts = createCartRepository(db);
  return createCheckoutService({
    unitOfWork: createUnitOfWork(db),
    carts,
    promos: createPromoRepository(db),
    payments: createPaymentRepository(db),
    orders: createOrderRepository(db),
    mailbox: createMailboxRepository(db),
    gateway: simulatedPaymentGateway,
    clock: { now: now ?? (() => new Date()) },
    products: createProductRepository(db),
    audit: createAuditWriter({
      repository: createAuditRepository(db),
      clock: { now: now ?? (() => new Date()) },
    }),
    inventory: createInventoryService({ repository: createInventoryRepository(db) }),
    ...checkoutDepthDependencies(db, { now: now ?? (() => new Date()) }),
  });
}

function paymentParams(
  cartId: string,
  idempotencyKey: string,
  userId: number | null = null,
): CheckoutParams {
  return {
    cartId,
    customerName: 'Delivery Test',
    customerEmail: 'delivery@example.test',
    deliveryDestination: adhocDestination,
    billingSelection: adhocBilling,
    deliverySlot: bookableSlot(),
    cardNumber: '4242 4242 4242 4242',
    cardExpiry: '12/99',
    cardCvc: '123',
    idempotencyKey,
    userId,
    auditContext: {
      actor: userId === null ? { type: 'anonymous', userId: null } : { type: 'user', userId },
      requestId: `request-${idempotencyKey}`,
    },
  };
}

/** Get the first active variant for a product */
function getVariantId(db: import('better-sqlite3').Database, productId: number): number {
  const row = db
    .prepare(
      'SELECT id FROM product_variants WHERE product_id = ? AND active = 1 ORDER BY sort_order LIMIT 1',
    )
    .get(productId) as { id: number } | undefined;
  if (!row) throw new Error(`No active variant for product ${productId}`);
  return row.id;
}

/** Get variant info including delivery_class and weight_grams */
function getVariantInfo(db: import('better-sqlite3').Database, variantId: number) {
  return db
    .prepare(
      'SELECT id, product_id, delivery_class, weight_grams, price_cents, sku, label FROM product_variants WHERE id = ?',
    )
    .get(variantId) as
    | {
        id: number;
        product_id: number;
        delivery_class: string;
        weight_grams: number;
        price_cents: number;
        sku: string;
        label: string;
      }
    | undefined;
}

void test('checkout delivery integration', async (t) => {
  let fixture = openSeededDatabase();
  let db = fixture.db;
  let carts = createCartRepository(db);
  t.after(() => fixture.cleanup());

  const setupFresh = async () => {
    await fixture.cleanup();
    fixture = openSeededDatabase();
    db = fixture.db;
    carts = createCartRepository(db);
  };

  await t.test('parcel order under 100kg has zero delivery charge', async () => {
    await setupFresh();
    const cartId = createCart(carts).cartId;
    const vId = getVariantId(db, 1);
    db.prepare(
      "UPDATE product_variants SET delivery_class = 'parcel', moq_sacks = 1 WHERE id = ?",
    ).run(vId);
    const variant = getVariantInfo(db, vId)!;
    assert.equal(variant.delivery_class, 'parcel');
    addItem(carts, cartId, String(vId));

    const service = checkoutService(db);
    const result = await service.process(paymentParams(cartId, 'parcel-under-100k'));

    assert.equal(result.success, true);
    if (!result.success) throw new Error('Expected success');
    const order = result.order;
    assert.equal(order.deliveryMode, 'parcel');
    assert.equal(order.deliveryChargeCents, 0);
    assert.ok(order.totalCents === order.subtotalCents - order.discountCents);
  });

  await t.test('freight delivery charge of 999c added to total', async () => {
    await setupFresh();
    const cartId = createCart(carts).cartId;

    // Find all active parcel variants and add enough to cross 100kg threshold
    const variants = db
      .prepare(
        'SELECT id, weight_grams, stock_count FROM product_variants WHERE active = 1 AND stock_count > 0 ORDER BY weight_grams DESC',
      )
      .all() as Array<{ id: number; weight_grams: number; stock_count: number }>;

    let totalWeightAdded = 0;
    const targetWeight = 100_000;
    for (const v of variants) {
      if (totalWeightAdded >= targetWeight) break;
      const availableQty = Math.min(
        v.stock_count,
        Math.ceil((targetWeight - totalWeightAdded) / Math.max(v.weight_grams, 1)),
      );
      if (availableQty <= 0) continue;
      addItem(carts, cartId, String(v.id));
      for (let i = 1; i < availableQty; i++) addItem(carts, cartId, String(v.id));
      totalWeightAdded += availableQty * v.weight_grams;
    }

    const cart = getCart(carts, cartId);
    if (!cart) throw new Error('Cart not found');
    assert.ok(cart.totalItems >= 1);

    const service = checkoutService(db);
    const result = await service.process(paymentParams(cartId, 'freight-order'));

    if (!result.success) {
      console.log('FREIGHT TEST FAILED:', JSON.stringify(result));
    }
    assert.equal(result.success, true, `Checkout failed: ${JSON.stringify(result)}`);
    if (!result.success) throw new Error(`Expected success, got: ${JSON.stringify(result)}`);
    const order = result.order;
    assert.equal(order.deliveryMode, 'freight');
    assert.equal(order.deliveryChargeCents, 999);
    assert.equal(order.totalCents, order.subtotalCents - order.discountCents + 999);
  });

  await t.test('idempotent payment replay preserves delivery totals', async () => {
    await setupFresh();
    const cartId = createCart(carts).cartId;
    const vId = getVariantId(db, 1);
    addItem(carts, cartId, String(vId));

    const service = checkoutService(db);
    const first = await service.process(paymentParams(cartId, 'replay-delivery'));
    assert.equal(first.success, true);
    if (!first.success) throw new Error('Expected success');
    const firstOrder = first.order;

    const replay = await service.process(paymentParams(cartId, 'replay-delivery'));
    assert.equal(replay.success, true);
    if (!replay.success) throw new Error('Expected replay success');
    const replayOrder = replay.order;

    assert.equal(replayOrder.id, firstOrder.id);
    assert.equal(replayOrder.totalCents, firstOrder.totalCents);
    assert.equal(replayOrder.deliveryMode, firstOrder.deliveryMode);
    assert.equal(replayOrder.deliveryChargeCents, firstOrder.deliveryChargeCents);
  });

  await t.test('SAVE10 promo discount excludes delivery from discount base', async () => {
    await setupFresh();
    const cartId = createCart(carts).cartId;
    // Add 5 items to qualify for SAVE10 (min 5 items)
    const vIds = [
      getVariantId(db, 1),
      getVariantId(db, 2),
      getVariantId(db, 3),
      getVariantId(db, 4),
      getVariantId(db, 5),
    ];
    for (const vId of vIds) addItem(carts, cartId, String(vId));

    const service = checkoutService(db);
    const result = await service.process({
      ...paymentParams(cartId, 'save10-delivery'),
      promoCode: 'SAVE10',
    });

    assert.equal(result.success, true);
    if (!result.success) throw new Error('Expected success');
    const order = result.order;
    assert.equal(order.promoApplied, 'SAVE10');
    assert.ok(order.discountCents > 0);
    // total = subtotal - discount + delivery
    assert.equal(
      order.totalCents,
      order.subtotalCents - order.discountCents + (order.deliveryChargeCents ?? 0),
    );
    // Discount should be 10% of subtotal, not of subtotal + delivery
    const expectedDiscount = Math.floor(order.subtotalCents * 0.1);
    assert.equal(order.discountCents, expectedDiscount);
  });

  await t.test('order lines have variant snapshots', async () => {
    await setupFresh();
    const cartId = createCart(carts).cartId;
    const vId = getVariantId(db, 1);
    const variant = getVariantInfo(db, vId)!;
    addItem(carts, cartId, String(vId));

    const service = checkoutService(db);
    const result = await service.process(paymentParams(cartId, 'variant-snap'));

    assert.equal(result.success, true);
    if (!result.success) throw new Error('Expected success');
    const order = result.order;
    assert.ok(order.items.length > 0);
    const item = order.items[0];
    assert.ok(item.variantSnapshot);
    assert.equal(item.variantSnapshot.variantId, vId);
    assert.equal(item.variantSnapshot.sku, variant.sku);
    assert.equal(item.variantSnapshot.label, variant.label);
    assert.equal(item.variantSnapshot.weightGrams, variant.weight_grams);
    assert.equal(item.variantSnapshot.deliveryClass, variant.delivery_class);
  });

  await t.test('order has delivery fields recorded', async () => {
    await setupFresh();
    const cartId = createCart(carts).cartId;
    const vId = getVariantId(db, 1);
    addItem(carts, cartId, String(vId));

    const service = checkoutService(db);
    const result = await service.process(paymentParams(cartId, 'delivery-fields'));

    assert.equal(result.success, true);
    if (!result.success) throw new Error('Expected success');
    const order = result.order;

    // Reload from DB to verify persistence
    const orders = createOrderRepository(db);
    const loaded = orders.findById(Number(order.id));
    assert.ok(loaded);
    assert.equal(loaded.deliveryMode, order.deliveryMode);
    assert.equal(loaded.deliveryChargeCents, order.deliveryChargeCents);
    assert.equal(loaded.deliveryWeightGrams, order.deliveryWeightGrams);
  });
});
