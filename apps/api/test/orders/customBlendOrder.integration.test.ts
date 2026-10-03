import assert from 'node:assert/strict';
import test from 'node:test';
import type Database from 'better-sqlite3';
import { Value } from '@sinclair/typebox/value';
import { CUSTOM_BLEND_FEE_CENTS, SACK_WEIGHT_GRAMS } from '@shop/contracts';
import { OrderDetailResponse, type OrderLineItem } from '@shop/contracts/orders';
import { buildApp } from '../../src/app.js';
import { adhocBilling, adhocDestination, bookableSlot } from '../checkout/checkoutDepthFixtures.js';
import { createSeededFixture } from '../support/seededDatabase.js';

type App = Awaited<ReturnType<typeof buildApp>>;

interface Lot {
  variantId: number;
  productId: number;
  priceCents: number;
}

/**
 * Three eligible lots in one mixing group: a blend base, its ingredient, and an unrelated lot
 * bought plainly, so a single order carries a configured line beside an ordinary sibling.
 */
function eligibleLots(db: Database.Database): { base: Lot; ingredient: Lot; ordinary: Lot } {
  const rows = db
    .prepare(
      `SELECT pv.id AS variantId, p.id AS productId, pv.price_cents AS priceCents
         FROM product_variants pv
         INNER JOIN products p ON p.id = pv.product_id
        WHERE p.active = 1 AND pv.active = 1 AND pv.sort_order = 1
          AND pv.weight_grams = ${SACK_WEIGHT_GRAMS}
          AND p.mixing_group = 'food-grade'
        ORDER BY pv.id ASC
        LIMIT 3`,
    )
    .all() as Lot[];
  if (rows.length < 3) throw new Error('Expected three eligible food-grade lots');
  return { base: rows[0]!, ingredient: rows[1]!, ordinary: rows[2]! };
}

function cookie(response: { headers: Record<string, string | string[] | undefined> }): string {
  const header = response.headers['set-cookie'];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error('Expected set-cookie');
  return value.split(';', 1)[0]!;
}

async function login(app: App, email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/login',
    payload: { email, password: 'Password123!', country: 'UK' },
  });
  assert.equal(response.statusCode, 200, response.body);
  return cookie(response);
}

/** Generous stock on every purchasable lot: tier and return rules, not availability, are on test. */
function stockUp(db: Database.Database, lots: ReturnType<typeof eligibleLots>): void {
  const update = db.prepare('UPDATE product_variants SET stock_count = 100000 WHERE id = ?');
  update.run(lots.base.variantId);
  update.run(lots.ordinary.variantId);
}

interface Fixture {
  app: App;
  db: Database.Database;
  lots: ReturnType<typeof eligibleLots>;
  close: () => Promise<void>;
}

async function fixture(label: string): Promise<Fixture> {
  void label;
  const seeded = await createSeededFixture();
  const { db, app } = seeded;
  const lots = eligibleLots(db);
  stockUp(db, lots);
  return {
    app,
    db,
    lots,
    close: seeded.cleanup,
  };
}

/** Configures a blend line and, optionally, an ordinary sibling line in a fresh cart. */
async function buildCart(
  app: App,
  sessionCookie: string,
  lots: ReturnType<typeof eligibleLots>,
  options: { blendSacks: number; ordinarySacks?: number },
): Promise<string> {
  const created = await app.inject({
    method: 'POST',
    url: '/api/cart',
    headers: { cookie: sessionCookie },
  });
  const cartId = created.json<{ cartId: string }>().cartId;

  const configured = await app.inject({
    method: 'POST',
    url: `/api/cart/${cartId}/custom-blends`,
    headers: { cookie: sessionCookie },
    payload: {
      baseVariantId: lots.base.variantId,
      ingredients: [{ variantId: lots.ingredient.variantId, percentage: 25 }],
      quantity: options.blendSacks,
    },
  });
  assert.equal(configured.statusCode, 200, configured.body);

  if (options.ordinarySacks !== undefined) {
    const added = await app.inject({
      method: 'POST',
      url: `/api/cart/${cartId}/items`,
      headers: { cookie: sessionCookie },
      payload: {
        productId: String(lots.ordinary.productId),
        variantId: lots.ordinary.variantId,
        quantity: options.ordinarySacks,
      },
    });
    assert.equal(added.statusCode, 200, added.body);
  }
  return cartId;
}

async function pay(
  app: App,
  sessionCookie: string,
  cartId: string,
  idempotencyKey: string,
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/payments/pay',
    headers: { cookie: sessionCookie },
    payload: {
      cartId,
      customerName: 'Blend Buyer',
      customerEmail: 'blend@example.test',
      deliveryDestination: adhocDestination,
      billingSelection: adhocBilling,
      deliverySlot: bookableSlot(),
      cardNumber: '4242 4242 4242 4242',
      cardExpiry: '12/99',
      cardCvc: '123',
      idempotencyKey,
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<{ id: string }>().id;
}

async function orderDetail(app: App, sessionCookie: string, orderId: string) {
  const response = await app.inject({
    method: 'GET',
    url: `/api/orders/${orderId}`,
    headers: { cookie: sessionCookie },
  });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json<unknown>();
  // The persisted snapshot must survive the transport boundary, not merely the database CHECKs.
  assert.equal(
    Value.Check(OrderDetailResponse, body),
    true,
    `order transport invalid: ${JSON.stringify(Array.from(Value.Errors(OrderDetailResponse, body)))}`,
  );
  return body as import('@shop/contracts/orders').OrderDetailResponse;
}

const findBlendLine = (items: OrderLineItem[]) => {
  const line = items.find((item) => item.customBlend !== undefined);
  if (!line) throw new Error('Expected a configured Custom Blend line');
  return line;
};

const findOrdinaryLine = (items: OrderLineItem[]) => {
  const line = items.find((item) => item.customBlend === undefined);
  if (!line) throw new Error('Expected an ordinary line');
  return line;
};

void test('a mixed order snapshots the blend and keeps its ordinary sibling returnable', async (t) => {
  const { app, db, lots, close } = await fixture('custom-blend-order');
  t.after(close);

  const bobCookie = await login(app, 'bob@example.com');
  const adminCookie = await login(app, 'admin@example.com');

  const blendSacks = 5;
  const ordinarySacks = 6;
  const cartId = await buildCart(app, bobCookie, lots, { blendSacks, ordinarySacks });
  const orderId = await pay(app, bobCookie, cartId, '22222222-2222-4222-8222-222222222221');

  const order = await orderDetail(app, bobCookie, orderId);
  const blendLine = findBlendLine(order.items);
  const ordinaryLine = findOrdinaryLine(order.items);

  const blendMaterialCents = lots.base.priceCents * blendSacks;
  const ordinaryTotalCents = lots.ordinary.priceCents * ordinarySacks;

  await t.test('the order line freezes the money split and the specification', () => {
    assert.equal(blendLine.blendingFeeCents, CUSTOM_BLEND_FEE_CENTS);
    assert.equal(blendLine.discountableTotalCents, blendMaterialCents);
    assert.equal(blendLine.lineTotalCents, blendMaterialCents + CUSTOM_BLEND_FEE_CENTS);
    assert.equal(blendLine.customBlend?.basePercentage, 75);
    assert.equal(blendLine.customBlend?.blendingFeeCents, CUSTOM_BLEND_FEE_CENTS);
    assert.equal(blendLine.customBlend?.madeToOrder, true);
    assert.equal(blendLine.customBlend?.returnable, false);
    assert.ok(blendLine.customBlend?.basePresentation?.category);
    assert.equal(blendLine.customBlend?.basePresentation?.consumptionClassification, 'food');
    assert.deepEqual(
      blendLine.customBlend?.ingredients.map((ingredient) => ingredient.variantId),
      [lots.ingredient.variantId],
    );
    // The base variant, not an ingredient, remains the purchasable identity of the line.
    assert.equal(blendLine.variantSnapshot?.variantId, lots.base.variantId);

    // An ordinary line in the same order stays byte-identical to a pre-blend release.
    assert.equal(ordinaryLine.blendingFeeCents, 0);
    assert.equal(ordinaryLine.discountableTotalCents, ordinaryTotalCents);
    assert.equal(ordinaryLine.lineTotalCents, ordinaryTotalCents);
    assert.equal(ordinaryLine.customBlend, undefined);
  });

  await t.test('only the base variant is allocated; no ingredient allocation row exists', () => {
    const allocated = db
      .prepare(
        `SELECT DISTINCT line.variant_id AS variantId
           FROM order_inventory_allocations allocation
           JOIN order_line_items line ON line.id = allocation.order_line_item_id
          WHERE line.order_id = ?`,
      )
      .all(Number(orderId)) as Array<{ variantId: number }>;
    const variantIds = allocated.map((row) => row.variantId).sort((a, b) => a - b);
    assert.deepEqual(
      variantIds,
      [lots.base.variantId, lots.ordinary.variantId].sort((a, b) => a - b),
    );
    assert.equal(variantIds.includes(lots.ingredient.variantId), false);
  });

  // ── Deliver both lines in one shipment ────────────────────────────
  const packed = await app.inject({
    method: 'POST',
    url: `/api/admin/orders/${orderId}/shipments`,
    headers: { cookie: adminCookie },
    payload: {
      version: order.version,
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
      shipments: [
        {
          trackingReference: 'TRK-BLEND-0001',
          lines: order.items.map((item) => ({ lineId: item.lineId, quantity: item.quantity })),
        },
      ],
    },
  });
  assert.equal(packed.statusCode, 200, packed.body);
  const shipment = packed.json<{ shipments: Array<{ id: string; version: number }> }>()
    .shipments[0]!;

  for (const [index, status] of (['shipped', 'delivered'] as const).entries()) {
    const transition = await app.inject({
      method: 'POST',
      url: `/api/admin/order-shipments/${shipment.id}/transition`,
      headers: { cookie: adminCookie },
      payload: {
        version: shipment.version + index,
        status,
        idempotencyKey: `22222222-2222-4222-8222-22222222223${index}`,
      },
    });
    assert.equal(transition.statusCode, 200, transition.body);
  }

  await t.test('return eligibility exposes the ordinary line and never the blend', async () => {
    const overview = await app.inject({
      method: 'GET',
      url: `/api/orders/${orderId}/returns`,
      headers: { cookie: bobCookie },
    });
    assert.equal(overview.statusCode, 200, overview.body);
    const lines = overview.json<{
      eligibleLines: Array<{ orderLineItemId: string; availableQuantity: number }>;
    }>().eligibleLines;

    assert.deepEqual(
      lines.map((line) => line.orderLineItemId),
      [ordinaryLine.lineId],
    );
    assert.equal(lines[0]!.availableQuantity, ordinarySacks);
  });

  await t.test('selecting the blend line is rejected as ineligible', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/orders/${orderId}/returns`,
      headers: { cookie: bobCookie },
      payload: {
        idempotencyKey: '22222222-2222-4222-8222-222222222240',
        reason: 'not_as_expected',
        selections: [{ shipmentId: shipment.id, orderLineItemId: blendLine.lineId, quantity: 1 }],
      },
    });
    assert.equal(response.statusCode, 422, response.body);
    assert.equal(response.json<{ code: string }>().code, 'RETURN_NOT_ELIGIBLE');
  });

  await t.test(
    'the ordinary line refunds its full value and the fee is never touched',
    async () => {
      const created = await app.inject({
        method: 'POST',
        url: `/api/orders/${orderId}/returns`,
        headers: { cookie: bobCookie },
        payload: {
          idempotencyKey: '22222222-2222-4222-8222-222222222241',
          reason: 'not_as_expected',
          selections: [
            {
              shipmentId: shipment.id,
              orderLineItemId: ordinaryLine.lineId,
              quantity: ordinarySacks,
            },
          ],
        },
      });
      assert.equal(created.statusCode, 200, created.body);
      const returnId = created.json<{ id: string }>().id;

      const step = async (path: string, version: number, key: string) => {
        const response = await app.inject({
          method: 'POST',
          url: `/api/admin/returns/${returnId}/${path}`,
          headers: { cookie: adminCookie },
          payload:
            path === 'decision'
              ? { version, idempotencyKey: key, decision: 'approve' }
              : { version, idempotencyKey: key },
        });
        assert.equal(response.statusCode, 200, response.body);
        return response;
      };

      await step('decision', 0, '22222222-2222-4222-8222-222222222242');
      await step('receive', 1, '22222222-2222-4222-8222-222222222243');
      const refunded = await step('refund', 2, '22222222-2222-4222-8222-222222222244');

      const refund = refunded.json<{ refund: { amountCents: number } }>().refund;
      // No promotion was applied, so the ordinary line refunds exactly its own value. The blending
      // fee sits on a different line and can neither inflate nor deflate this amount.
      assert.equal(refund.amountCents, ordinaryTotalCents);

      const blendRefunds = db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM refund_items ri
           JOIN return_request_items rri ON rri.id = ri.return_request_item_id
          WHERE rri.order_line_item_id = ?`,
        )
        .get(Number(blendLine.lineId)) as { count: number };
      assert.equal(blendRefunds.count, 0);

      // Received stock returns to the ordinary lot only.
      const restored = db
        .prepare(
          `SELECT DISTINCT variant_id AS variantId FROM inventory_stock_movements
          WHERE movement_type = 'return_received' AND return_request_id = ?`,
        )
        .all(Number(returnId)) as Array<{ variantId: number }>;
      assert.deepEqual(
        restored.map((row) => row.variantId),
        [lots.ordinary.variantId],
      );
    },
  );
});

void test('a promotion prorates on discountable totals, never on the blending fee', async (t) => {
  const { app, lots, close } = await fixture('custom-blend-order-promo');
  t.after(close);

  const bobCookie = await login(app, 'bob@example.com');
  const blendSacks = 5;
  const ordinarySacks = 6;
  const cartId = await buildCart(app, bobCookie, lots, { blendSacks, ordinarySacks });

  const applied = await app.inject({
    method: 'POST',
    url: '/api/promo/validate',
    headers: { cookie: bobCookie },
    payload: { cartId, promoCode: 'SAVE10' },
  });
  assert.equal(applied.statusCode, 200, applied.body);

  const response = await app.inject({
    method: 'POST',
    url: '/api/payments/pay',
    headers: { cookie: bobCookie },
    payload: {
      cartId,
      promoCode: 'SAVE10',
      customerName: 'Blend Buyer',
      customerEmail: 'blend@example.test',
      deliveryDestination: adhocDestination,
      billingSelection: adhocBilling,
      deliverySlot: bookableSlot(),
      cardNumber: '4242 4242 4242 4242',
      cardExpiry: '12/99',
      cardCvc: '123',
      idempotencyKey: '33333333-3333-4333-8333-333333333331',
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  const orderId = response.json<{ id: string }>().id;

  const order = await orderDetail(app, bobCookie, orderId);
  const blendMaterialCents = lots.base.priceCents * blendSacks;
  const ordinaryTotalCents = lots.ordinary.priceCents * ordinarySacks;

  // The promotion base excludes the fee, so the order subtotal exceeds it by exactly the fee.
  const discountableSubtotalCents = blendMaterialCents + ordinaryTotalCents;
  assert.equal(order.subtotalCents, discountableSubtotalCents + CUSTOM_BLEND_FEE_CENTS);
  assert.equal(order.discountCents, Math.floor((discountableSubtotalCents * 10) / 100));
  assert.equal(
    order.items.reduce((total, item) => total + item.discountableTotalCents, 0),
    discountableSubtotalCents,
  );
  assert.equal(
    order.items.reduce((total, item) => total + item.blendingFeeCents, 0),
    CUSTOM_BLEND_FEE_CENTS,
  );
});

void test('cancelling a blend order restores the base lot and never an ingredient', async (t) => {
  const { app, db, lots, close } = await fixture('custom-blend-order-cancel');
  t.after(close);

  const readStock = (variantId: number) =>
    (
      db.prepare('SELECT stock_count FROM product_variants WHERE id = ?').get(variantId) as {
        stock_count: number;
      }
    ).stock_count;

  const bobCookie = await login(app, 'bob@example.com');
  const blendSacks = 5;
  const ingredientStockBefore = readStock(lots.ingredient.variantId);

  const cartId = await buildCart(app, bobCookie, lots, { blendSacks });
  const orderId = await pay(app, bobCookie, cartId, '55555555-5555-4555-8555-555555555551');

  const baseStockAfterPurchase = readStock(lots.base.variantId);

  const cancelled = await app.inject({
    method: 'POST',
    url: `/api/orders/${orderId}/cancel`,
    headers: { cookie: bobCookie },
    payload: { version: 0, idempotencyKey: '55555555-5555-4555-8555-555555555552' },
  });
  assert.equal(cancelled.statusCode, 200, cancelled.body);
  assert.equal(cancelled.json<{ status: string }>().status, 'cancelled');

  // Only the purchasable base variant moves. An ingredient is a recipe fact, never stock demand,
  // so it can neither be consumed at purchase nor credited back at cancellation.
  const movements = db
    .prepare(
      `SELECT DISTINCT variant_id AS variantId FROM inventory_stock_movements
        WHERE movement_type = 'cancellation_restored' AND order_id = ?`,
    )
    .all(Number(orderId)) as Array<{ variantId: number }>;
  assert.deepEqual(
    movements.map((row) => row.variantId),
    [lots.base.variantId],
  );
  assert.equal(readStock(lots.base.variantId), baseStockAfterPurchase + blendSacks);
  assert.equal(readStock(lots.ingredient.variantId), ingredientStockBefore);
});

void test('an unreadable Custom Blend snapshot fails the order read closed', async (t) => {
  const { app, db, lots, close } = await fixture('custom-blend-order-corrupt');
  t.after(close);

  const bobCookie = await login(app, 'bob@example.com');
  const cartId = await buildCart(app, bobCookie, lots, { blendSacks: 5 });
  const orderId = await pay(app, bobCookie, cartId, '44444444-4444-4444-8444-444444444441');

  const order = await orderDetail(app, bobCookie, orderId);
  const blendLine = findBlendLine(order.items);

  // Schema-invalid presentation metadata must not degrade into a guessed food bag on an
  // otherwise valid financial snapshot.
  db.prepare('UPDATE order_line_items SET custom_blend_json = ? WHERE id = ?').run(
    JSON.stringify({
      ...blendLine.customBlend,
      basePresentation: {
        ...blendLine.customBlend?.basePresentation,
        unexpected: true,
      },
    }),
    Number(blendLine.lineId),
  );

  const response = await app.inject({
    method: 'GET',
    url: `/api/orders/${orderId}`,
    headers: { cookie: bobCookie },
  });
  assert.equal(response.statusCode, 500, response.body);
});
