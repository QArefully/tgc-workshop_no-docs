import assert from 'node:assert/strict';
import test from 'node:test';
import type Database from 'better-sqlite3';
import { Value } from '@sinclair/typebox/value';
import { Cart, CreateCartResponse } from '@shop/contracts/cart';
import { CustomBlendSnapshot as CustomBlendSnapshotSchema } from '@shop/contracts';
import { ReorderResponse } from '@shop/contracts/reorder';
import { buildApp } from '../../src/app.js';
import { createCartRepository } from '../../src/features/cart/cartRepository.js';
import { createOrderRepository } from '../../src/features/orders/orderRepository.js';
import type { CreateOrderParams } from '../../src/features/orders/orderTypes.js';
import { createSeededFixture } from '../support/seededDatabase.js';

const NOW = new Date('2026-07-31T12:00:00.000Z');
const ALICE = 'alice@example.com';
const ADMIN = 'admin@example.com';
/** Seeded customer ids: `alice@example.com` owns 1, `bob@example.com` owns 2. */
const ALICE_USER_ID = 1;
const BOB_USER_ID = 2;

type App = Awaited<ReturnType<typeof buildApp>>;
type OrderLine = CreateOrderParams['items'][number];

interface Fixture {
  db: Database.Database;
  app: App;
  orders: ReturnType<typeof createOrderRepository>;
  cleanup: () => Promise<void>;
}

async function openFixture(name: string): Promise<Fixture> {
  void name;
  const seeded = await createSeededFixture({ app: { clock: { now: () => NOW } } });
  const { db, app } = seeded;
  return {
    db,
    app,
    orders: createOrderRepository(db),
    cleanup: seeded.cleanup,
  };
}

function cookieValue(response: { headers: Record<string, string | string[] | undefined> }): string {
  const header = response.headers['set-cookie'];
  const cookie = Array.isArray(header) ? header[0] : header;
  if (!cookie) throw new Error('Expected set-cookie header');
  return cookie.split(';', 1)[0]!;
}

async function login(app: App, email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/login',
    payload: { email, password: 'Password123!', country: 'UK' },
  });
  assert.equal(response.statusCode, 200);
  return cookieValue(response);
}

async function createCart(app: App): Promise<string> {
  const created = await app.inject({ method: 'POST', url: '/api/cart' });
  return Value.Parse(CreateCartResponse, created.json()).cartId;
}

interface PersistedCustomBlendSpec {
  configKey: string;
  basePercentage: number;
  mixingGroup: string;
  ingredients: Array<{
    variantId: number;
    productId: string;
    productName: string;
    productDescription: string;
    mixingGroup: string;
    percentage: number;
  }>;
  blendingFeeCents: number;
  madeToOrder: true;
  returnable: false;
}

function parsePersistedCustomBlend(json: string): PersistedCustomBlendSpec {
  const parsed: unknown = JSON.parse(json);
  if (!Value.Check(CustomBlendSnapshotSchema, parsed)) {
    throw new Error('Expected a valid persisted Custom Blend specification');
  }
  return parsed;
}

interface Lot {
  id: number;
  product_id: number;
  sku: string;
  label: string;
  weight_grams: number;
  price_cents: number;
  moq_sacks: number;
  delivery_class: string;
  consumption_classification: string;
}

/** Distinct sellable default lots, with the catalog facts an order-line snapshot needs. */
function lots(db: Database.Database, count: number): Lot[] {
  const rows = db
    .prepare(
      `SELECT pv.id, pv.product_id, pv.sku, pv.label, pv.weight_grams, pv.price_cents,
              pv.moq_sacks, pv.delivery_class, p.consumption_classification
       FROM product_variants pv INNER JOIN products p ON p.id = pv.product_id
       WHERE pv.active = 1 AND p.active = 1 AND pv.sort_order = 1
       ORDER BY pv.id LIMIT ?`,
    )
    .all(count) as Lot[];
  assert.equal(rows.length, count, 'seed must expose enough sellable lots');
  return rows;
}

/**
 * Pins every live fact the classifier reads, clearance included, so a scenario is not silently
 * shifted by whichever seeded lot happens to sort first.
 */
function pin(
  db: Database.Database,
  lot: Lot,
  facts: { stock: number; moqSacks: number; backorderable?: number; priceCents?: number },
): Lot {
  db.prepare(
    `UPDATE product_variants
     SET stock_count = ?, moq_sacks = ?, backorderable = ?, price_cents = COALESCE(?, price_cents),
         clearance_price_cents = NULL, clearance_starts_at = NULL, clearance_ends_at = NULL
     WHERE id = ?`,
  ).run(facts.stock, facts.moqSacks, facts.backorderable ?? 0, facts.priceCents ?? null, lot.id);
  return { ...lot, moq_sacks: facts.moqSacks, price_cents: facts.priceCents ?? lot.price_cents };
}

function line(lot: Lot, quantity: number, unitPriceCents = lot.price_cents): OrderLine {
  const lineTotalCents = unitPriceCents * quantity;
  return {
    productId: String(lot.product_id),
    productName: lot.label,
    unitPriceCents,
    quantity,
    discountableTotalCents: lineTotalCents,
    blendingFeeCents: 0,
    lineTotalCents,
    variantSnapshot: {
      variantId: lot.id,
      sku: lot.sku,
      label: lot.label,
      weightGrams: lot.weight_grams,
      consumptionClassification: lot.consumption_classification as 'food' | 'non-food' | 'caution',
      deliveryClass: lot.delivery_class as 'parcel' | 'freight',
    },
  };
}

async function createPersistedBlend(
  app: App,
  db: Database.Database,
  base: Lot,
  ingredientVariantId: number,
  percentage = 10,
  quantity = 4,
): Promise<{ snapshot: PersistedCustomBlendSpec; resolvedUnitPriceCents: number }> {
  const scratchCartId = await createCart(app);
  const configured = await app.inject({
    method: 'POST',
    url: `/api/cart/${scratchCartId}/custom-blends`,
    payload: {
      baseVariantId: base.id,
      ingredients: [{ variantId: ingredientVariantId, percentage }],
      quantity,
    },
  });
  assert.equal(configured.statusCode, 200, configured.body);
  const configuredCart = Value.Parse(Cart, configured.json());
  const configuredItem = configuredCart.items[0];
  assert.ok(configuredItem?.customBlend && 'components' in configuredItem.customBlend);
  assert.ok(configuredItem, 'expected a configured cart line');
  const resolvedUnitPriceCents = configuredItem.resolvedUnitPriceCents;
  assert.equal(resolvedUnitPriceCents, configuredItem.customBlend.materialUnitPriceCents);

  const stored = db
    .prepare("SELECT custom_blend_json FROM cart_line_items WHERE cart_id = ? AND config_key <> ''")
    .get(scratchCartId) as { custom_blend_json: string } | undefined;
  assert.ok(stored, 'expected a persisted configured specification');
  return { snapshot: parsePersistedCustomBlend(stored.custom_blend_json), resolvedUnitPriceCents };
}

/** An order line whose variant reference was lost; `order_line_items.variant_id` is nullable. */
function unresolvedLine(lot: Lot, quantity: number): OrderLine {
  const withSnapshot = line(lot, quantity);
  delete withSnapshot.variantSnapshot;
  return withSnapshot;
}

function placeOrder(
  orders: ReturnType<typeof createOrderRepository>,
  userId: number,
  items: OrderLine[],
): number {
  const subtotalCents = items.reduce((total, item) => total + item.lineTotalCents, 0);
  return orders.create({
    customerName: 'Reorder Customer',
    customerEmail: 'reorder@example.test',
    shippingAddress: '1 Test Street',
    promoApplied: null,
    subtotalCents,
    discountCents: 0,
    totalCents: subtotalCents,
    userId,
    items,
    createdAt: '2026-07-20T00:00:00.000Z',
  });
}

async function reorder(
  app: App,
  cookie: string,
  orderId: number,
  cartId: string,
): Promise<{ statusCode: number; body: unknown }> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/orders/${orderId}/reorder`,
    headers: { cookie },
    payload: { cartId },
  });
  return { statusCode: response.statusCode, body: response.json() };
}

/** Reorders and asserts the payload really validates against the published response contract. */
async function reorderOk(
  app: App,
  cookie: string,
  orderId: number,
  cartId: string,
): Promise<ReorderResponse> {
  const { statusCode, body } = await reorder(app, cookie, orderId, cartId);
  assert.equal(statusCode, 200, JSON.stringify(body));
  if (!Value.Check(ReorderResponse, body)) {
    const first = [...Value.Errors(ReorderResponse, body)][0];
    assert.fail(`ReorderResponse violation at ${first?.path ?? '/'}: ${first?.message ?? '?'}`);
  }
  return body;
}

function cartLineQuantities(db: Database.Database, cartId: string): Array<[number, number]> {
  return (
    db
      .prepare(
        'SELECT variant_id, quantity FROM cart_line_items WHERE cart_id = ? ORDER BY variant_id',
      )
      .all(cartId) as Array<{ variant_id: number; quantity: number }>
  ).map((row) => [row.variant_id, row.quantity]);
}

void test('reorder re-adds eligible order lines, reports each skip, and repeats additively', async (t) => {
  const fixture = await openFixture('reorder-mixed');
  t.after(fixture.cleanup);
  const { db, app, orders } = fixture;
  const [live, short, belowMoq, retired, orphan] = lots(db, 5) as [Lot, Lot, Lot, Lot, Lot];
  pin(db, live, { stock: 1_000, moqSacks: 1 });
  pin(db, short, { stock: 1, moqSacks: 1 });
  pin(db, belowMoq, { stock: 1_000, moqSacks: 400 });
  pin(db, retired, { stock: 1_000, moqSacks: 1 });
  pin(db, orphan, { stock: 1_000, moqSacks: 1 });

  const orderId = placeOrder(orders, ALICE_USER_ID, [
    line(live, 4),
    line(short, 5),
    line(belowMoq, 1),
    line(retired, 4),
    unresolvedLine(orphan, 3),
    line(live, 2),
  ]);
  // Retired after the order exists: history keeps the lot, the catalog no longer sells it.
  db.prepare('UPDATE product_variants SET active = 0 WHERE id = ?').run(retired.id);

  const cookie = await login(app, ALICE);
  const cartId = await createCart(app);
  const first = await reorderOk(app, cookie, orderId, cartId);

  assert.deepEqual(
    first.outcomes.map((outcome) => [outcome.status, outcome.reason]),
    [
      ['added', null],
      ['skipped', 'INSUFFICIENT_STOCK'],
      ['skipped', 'BELOW_MOQ'],
      ['skipped', 'VARIANT_RETIRED'],
      ['skipped', 'VARIANT_UNRESOLVED'],
      ['added', null],
    ],
  );
  assert.equal(first.addedLineCount, 2);
  assert.equal(first.skippedLineCount, 4);
  assert.equal(first.outcomes[4]?.variantId, null);
  // Duplicate lines sharing one identity aggregate into a single demand and a single cart line.
  assert.deepEqual(cartLineQuantities(db, cartId), [[live.id, 6]]);
  assert.equal(first.cart.id, cartId);
  assert.equal(first.cart.totalItems, 6);

  // No idempotency key: a repeat action increments the same line, exactly like a plain add.
  const second = await reorderOk(app, cookie, orderId, cartId);
  assert.equal(second.addedLineCount, 2);
  assert.deepEqual(cartLineQuantities(db, cartId), [[live.id, 12]]);
  assert.equal(second.cart.totalItems, 12);

  // The wired audit writer records one reorder event per request, against the acting buyer.
  assert.deepEqual(
    (
      db
        .prepare(
          `SELECT metadata_json, actor_user_id FROM audit_events
           WHERE action = 'cart.reorder_added' AND entity_id = ? ORDER BY id`,
        )
        .all(cartId) as Array<{ metadata_json: string; actor_user_id: number | null }>
    ).map((row) => [JSON.parse(row.metadata_json) as unknown, row.actor_user_id]),
    [
      [{ orderId, addedLineCount: 2, skippedLineCount: 4 }, ALICE_USER_ID],
      [{ orderId, addedLineCount: 2, skippedLineCount: 4 }, ALICE_USER_ID],
    ],
  );
});

void test('an all-skipped reorder succeeds and leaves the cart untouched', async (t) => {
  const fixture = await openFixture('reorder-all-skipped');
  t.after(fixture.cleanup);
  const { db, app, orders } = fixture;
  const [seeded, retired] = lots(db, 2) as [Lot, Lot];
  pin(db, seeded, { stock: 1_000, moqSacks: 1 });
  pin(db, retired, { stock: 1_000, moqSacks: 1 });

  const orderId = placeOrder(orders, ALICE_USER_ID, [line(retired, 4)]);
  db.prepare('UPDATE product_variants SET active = 0 WHERE id = ?').run(retired.id);

  const cookie = await login(app, ALICE);
  const cartId = await createCart(app);
  const seededAdd = await app.inject({
    method: 'POST',
    url: `/api/cart/${cartId}/items`,
    payload: { productId: String(seeded.product_id), variantId: seeded.id, quantity: 4 },
  });
  assert.equal(seededAdd.statusCode, 200);
  const before = Value.Parse(Cart, seededAdd.json());
  const updatedAtBefore = (
    db.prepare('SELECT updated_at FROM carts WHERE id = ?').get(cartId) as { updated_at: string }
  ).updated_at;

  const report = await reorderOk(app, cookie, orderId, cartId);
  assert.equal(report.addedLineCount, 0);
  assert.equal(report.skippedLineCount, 1);
  assert.equal(report.outcomes[0]?.reason, 'VARIANT_RETIRED');
  assert.deepEqual(report.cart, before);
  assert.deepEqual(cartLineQuantities(db, cartId), [[seeded.id, 4]]);
  assert.equal(
    (db.prepare('SELECT updated_at FROM carts WHERE id = ?').get(cartId) as { updated_at: string })
      .updated_at,
    updatedAtBefore,
  );
});

void test('reorder gates on a customer session, order ownership, and cart availability', async (t) => {
  const fixture = await openFixture('reorder-gates');
  t.after(fixture.cleanup);
  const { db, app, orders } = fixture;
  const [lot] = lots(db, 1) as [Lot];
  pin(db, lot, { stock: 1_000, moqSacks: 1 });
  const aliceOrderId = placeOrder(orders, ALICE_USER_ID, [line(lot, 4)]);
  const bobOrderId = placeOrder(orders, BOB_USER_ID, [line(lot, 4)]);

  const aliceCookie = await login(app, ALICE);
  const adminCookie = await login(app, ADMIN);
  const cartId = await createCart(app);

  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: `/api/orders/${aliceOrderId}/reorder`,
        payload: { cartId },
      })
    ).statusCode,
    401,
  );
  assert.equal((await reorder(app, adminCookie, aliceOrderId, cartId)).statusCode, 403);

  // Ownership failure and a missing order are indistinguishable, and both carry the code the
  // buyer-facing client maps to its own wording.
  const unowned = await reorder(app, aliceCookie, bobOrderId, cartId);
  assert.equal(unowned.statusCode, 404);
  assert.equal((unowned.body as { code: string }).code, 'ORDER_NOT_FOUND');
  const missingOrder = await reorder(app, aliceCookie, bobOrderId + 1_000, cartId);
  assert.equal(missingOrder.statusCode, 404);
  assert.equal((missingOrder.body as { code: string }).code, 'ORDER_NOT_FOUND');

  const missingCart = await reorder(app, aliceCookie, aliceOrderId, 'no-such-cart');
  assert.equal(missingCart.statusCode, 404);
  assert.equal((missingCart.body as { code: string }).code, 'CART_NOT_FOUND');

  const reservationKey = 'reorder-reservation';
  db.prepare(
    `INSERT INTO payments
      (idempotency_key, request_fingerprint, status, amount_cents, card_last4, card_brand,
       reservation_expires_at)
     VALUES (?, ?, 'prepared', 1, '4242', 'Visa', '2026-08-01T12:00:00.000Z')`,
  ).run(reservationKey, reservationKey);
  assert.equal(createCartRepository(db).reserve(cartId, reservationKey, NOW.toISOString()), true);
  const reserved = await reorder(app, aliceCookie, aliceOrderId, cartId);
  assert.equal(reserved.statusCode, 409);
  assert.equal((reserved.body as { code: string }).code, 'CART_RESERVED');
  assert.deepEqual(cartLineQuantities(db, cartId), []);
});

void test('reorder discloses server-derived price drift once a clearance window is active', async (t) => {
  const fixture = await openFixture('reorder-price-drift');
  t.after(fixture.cleanup);
  const { db, app, orders } = fixture;
  const [drifting, skippedDrifting, steady] = lots(db, 3) as [Lot, Lot, Lot];
  // 25 kg sacks at these quantities stay below the first quantity-break tier, so the resolved unit
  // price is exactly the clearance price: a concrete number, not merely "something non-null".
  pin(db, drifting, { stock: 1_000, moqSacks: 1, priceCents: 1_000 });
  pin(db, skippedDrifting, { stock: 1_000, moqSacks: 400, priceCents: 2_000 });
  pin(db, steady, { stock: 1_000, moqSacks: 1, priceCents: 3_000 });
  assert.equal(drifting.weight_grams, 25_000);
  assert.equal(skippedDrifting.weight_grams, 25_000);
  assert.equal(steady.weight_grams, 25_000);

  const orderId = placeOrder(orders, ALICE_USER_ID, [
    line({ ...drifting, price_cents: 1_000 }, 2, 1_000),
    line({ ...skippedDrifting, price_cents: 2_000 }, 1, 2_000),
    line({ ...steady, price_cents: 3_000 }, 2, 3_000),
  ]);

  // The clearance opens after the order was placed and is live at the injected clock.
  db.prepare(
    `UPDATE product_variants
     SET clearance_price_cents = ?, clearance_starts_at = ?, clearance_ends_at = ?
     WHERE id IN (?, ?)`,
  ).run(
    800,
    '2026-07-30T00:00:00.000Z',
    '2026-08-02T00:00:00.000Z',
    drifting.id,
    skippedDrifting.id,
  );

  const cookie = await login(app, ALICE);
  const cartId = await createCart(app);
  const report = await reorderOk(app, cookie, orderId, cartId);

  // Added line: priced by the cart at the post-add cumulative quantity.
  assert.equal(report.outcomes[0]?.status, 'added');
  assert.equal(report.outcomes[0]?.orderedUnitPriceCents, 1_000);
  assert.equal(report.outcomes[0]?.currentUnitPriceCents, 800);
  assert.equal(report.outcomes[0]?.priceChanged, true);

  // Skipped line: priced by the reorder service itself at the originally ordered quantity, which
  // is the only path that exercises its own clearance-then-tier composition.
  assert.equal(report.outcomes[1]?.status, 'skipped');
  assert.equal(report.outcomes[1]?.reason, 'BELOW_MOQ');
  assert.equal(report.outcomes[1]?.orderedUnitPriceCents, 2_000);
  assert.equal(report.outcomes[1]?.currentUnitPriceCents, 800);
  assert.equal(report.outcomes[1]?.priceChanged, true);

  // Unchanged line: equal prices report no drift rather than a null current price.
  assert.equal(report.outcomes[2]?.currentUnitPriceCents, 3_000);
  assert.equal(report.outcomes[2]?.priceChanged, false);
});

void test('reorder re-adds a Custom Blend line under its original config key', async (t) => {
  const fixture = await openFixture('reorder-blend');
  t.after(fixture.cleanup);
  const { db, app, orders } = fixture;
  const blendLots = db
    .prepare(
      `SELECT pv.id, pv.product_id, pv.sku, pv.label, pv.weight_grams, pv.price_cents,
              pv.moq_sacks, pv.delivery_class, p.consumption_classification
       FROM product_variants pv INNER JOIN products p ON p.id = pv.product_id
       WHERE p.active = 1 AND pv.active = 1 AND pv.sort_order = 1 AND pv.weight_grams = 25000
         AND p.mixing_group = (
           SELECT p2.mixing_group
           FROM product_variants pv2 INNER JOIN products p2 ON p2.id = pv2.product_id
           WHERE p2.active = 1 AND pv2.active = 1 AND pv2.sort_order = 1 AND pv2.weight_grams = 25000
             AND p2.mixing_group NOT IN ('pigments', 'absorbents')
           GROUP BY p2.mixing_group HAVING COUNT(*) >= 2 ORDER BY p2.mixing_group LIMIT 1
         )
       ORDER BY pv.id LIMIT 2`,
    )
    .all() as Lot[];
  assert.equal(blendLots.length, 2, 'seed must expose two blendable lots');
  const [base, ingredient] = blendLots as [Lot, Lot];
  const pinnedBase = pin(db, base, { stock: 1_000, moqSacks: 1 });

  // Build the frozen specification the way checkout would, through the live configured-line path.
  const scratchCartId = await createCart(app);
  const configured = await app.inject({
    method: 'POST',
    url: `/api/cart/${scratchCartId}/custom-blends`,
    payload: {
      baseVariantId: pinnedBase.id,
      ingredients: [{ variantId: ingredient.id, percentage: 10 }],
      quantity: 4,
    },
  });
  assert.equal(configured.statusCode, 200, configured.body);
  const configuredCart = Value.Parse(Cart, configured.json());
  const resolvedSnapshot = configuredCart.items[0]?.customBlend;
  assert.ok(resolvedSnapshot, 'expected a configured cart line');
  assert.ok('components' in resolvedSnapshot, 'cart should expose a resolved blend outcome');
  const stored = db
    .prepare("SELECT custom_blend_json FROM cart_line_items WHERE cart_id = ? AND config_key <> ''")
    .get(scratchCartId) as { custom_blend_json: string } | undefined;
  assert.ok(stored, 'expected a persisted configured specification');
  const snapshot = parsePersistedCustomBlend(stored.custom_blend_json);
  assert.equal('components' in snapshot, false);
  assert.equal('quantity' in snapshot, false);

  const blendLine: OrderLine = {
    ...line(pinnedBase, 4),
    blendingFeeCents: snapshot.blendingFeeCents,
    customBlend: snapshot,
  };
  const orderId = placeOrder(orders, ALICE_USER_ID, [blendLine]);

  const cookie = await login(app, ALICE);
  const cartId = await createCart(app);
  const report = await reorderOk(app, cookie, orderId, cartId);

  assert.equal(report.addedLineCount, 1);
  assert.equal(report.outcomes[0]?.status, 'added');
  assert.equal(report.outcomes[0]?.configKey, snapshot.configKey);
  assert.equal(report.cart.items.length, 1);
  assert.equal(report.cart.items[0]?.configKey, snapshot.configKey);
  assert.equal(report.cart.items[0]?.quantity, 4);
  const reorderedBlend = report.cart.items[0]?.customBlend;
  assert.ok(reorderedBlend && 'components' in reorderedBlend);
  assert.equal(reorderedBlend.quantity, 4);
  assert.deepEqual(
    reorderedBlend.components.map((component) => component.variantId),
    [pinnedBase.id, ingredient.id],
  );
  assert.deepEqual(
    (
      db.prepare('SELECT config_key FROM cart_line_items WHERE cart_id = ?').all(cartId) as Array<{
        config_key: string;
      }>
    ).map((row) => row.config_key),
    [snapshot.configKey],
  );
  const reorderedStored = db
    .prepare("SELECT custom_blend_json FROM cart_line_items WHERE cart_id = ? AND config_key <> ''")
    .get(cartId) as { custom_blend_json: string } | undefined;
  assert.ok(reorderedStored);
  const reorderedSpec = parsePersistedCustomBlend(reorderedStored.custom_blend_json);
  assert.equal('components' in reorderedSpec, false);
  assert.equal('quantity' in reorderedSpec, false);
});

void test('reorder keeps resolver pricing for skipped Custom Blend lines', async (t) => {
  const fixture = await openFixture('reorder-blend-price-skips');
  t.after(fixture.cleanup);
  const { db, app, orders } = fixture;
  const blendLots = db
    .prepare(
      `SELECT pv.id, pv.product_id, pv.sku, pv.label, pv.weight_grams, pv.price_cents,
              pv.moq_sacks, pv.delivery_class, p.consumption_classification
       FROM product_variants pv INNER JOIN products p ON p.id = pv.product_id
       WHERE p.active = 1 AND pv.active = 1 AND pv.sort_order = 1 AND pv.weight_grams = 25000
         AND p.mixing_group = (
           SELECT p2.mixing_group
           FROM product_variants pv2 INNER JOIN products p2 ON p2.id = pv2.product_id
           WHERE p2.active = 1 AND pv2.active = 1 AND pv2.sort_order = 1 AND pv2.weight_grams = 25000
             AND p2.mixing_group NOT IN ('pigments', 'absorbents')
           GROUP BY p2.mixing_group HAVING COUNT(*) >= 2 ORDER BY p2.mixing_group LIMIT 1
         )
       ORDER BY pv.id LIMIT 2`,
    )
    .all() as Lot[];
  assert.equal(blendLots.length, 2, 'seed must expose two blendable lots');
  const [base, ingredient] = blendLots as [Lot, Lot];
  const pinnedBase = pin(db, base, { stock: 1_000, moqSacks: 1, priceCents: 1_000 });
  db.prepare(
    `UPDATE product_variants
     SET price_cents = ?, clearance_price_cents = NULL,
         clearance_starts_at = NULL, clearance_ends_at = NULL
     WHERE id = ?`,
  ).run(10_000, ingredient.id);
  const { snapshot, resolvedUnitPriceCents } = await createPersistedBlend(
    app,
    db,
    pinnedBase,
    ingredient.id,
  );
  assert.notEqual(resolvedUnitPriceCents, pinnedBase.price_cents);

  const blendLine: OrderLine = {
    ...line(pinnedBase, 4, pinnedBase.price_cents),
    blendingFeeCents: snapshot.blendingFeeCents,
    customBlend: snapshot,
  };

  // A stock skip still has a valid resolver snapshot and must disclose its configured material
  // price, rather than silently comparing against the base variant price.
  const stockOrderId = placeOrder(orders, ALICE_USER_ID, [blendLine]);
  db.prepare('UPDATE product_variants SET stock_count = 0, backorderable = 0 WHERE id = ?').run(
    pinnedBase.id,
  );
  const cookie = await login(app, ALICE);
  const stockCartId = await createCart(app);
  const stockReport = await reorderOk(app, cookie, stockOrderId, stockCartId);
  assert.equal(stockReport.outcomes[0]?.status, 'skipped');
  assert.equal(stockReport.outcomes[0]?.reason, 'INSUFFICIENT_STOCK');
  assert.equal(stockReport.outcomes[0]?.currentUnitPriceCents, resolvedUnitPriceCents);
  assert.equal(stockReport.outcomes[0]?.priceChanged, true);
  assert.deepEqual(stockReport.cart.items, []);

  // A MOQ skip follows the same rule after stock is restored; the resolver still prices the
  // requested quantity even though the cart classifier refuses to add it.
  const moqOrderId = placeOrder(orders, ALICE_USER_ID, [blendLine]);
  db.prepare('UPDATE product_variants SET stock_count = 1_000, moq_sacks = 40 WHERE id = ?').run(
    pinnedBase.id,
  );
  const moqCartId = await createCart(app);
  const moqReport = await reorderOk(app, cookie, moqOrderId, moqCartId);
  assert.equal(moqReport.outcomes[0]?.status, 'skipped');
  assert.equal(moqReport.outcomes[0]?.reason, 'BELOW_MOQ');
  assert.equal(moqReport.outcomes[0]?.currentUnitPriceCents, resolvedUnitPriceCents);
  assert.equal(moqReport.outcomes[0]?.priceChanged, true);
  assert.deepEqual(moqReport.cart.items, []);
});

void test('reorder keeps resolver pricing for a country-blocked Custom Blend', async (t) => {
  const fixture = await openFixture('reorder-blend-country-price');
  t.after(fixture.cleanup);
  const { db, app, orders } = fixture;
  const pair = db
    .prepare(
      `SELECT base.id, base.product_id, base.sku, base.label, base.weight_grams,
              base.price_cents, base.moq_sacks, base.delivery_class,
              base_product.consumption_classification,
              ingredient.id AS ingredient_id
       FROM product_variants base
       INNER JOIN products base_product ON base_product.id = base.product_id
       INNER JOIN products ingredient_product
         ON ingredient_product.mixing_group = base_product.mixing_group
       INNER JOIN product_variants ingredient ON ingredient.product_id = ingredient_product.id
       WHERE base_product.category != 'Sports Nutrition'
         AND ingredient_product.category = 'Sports Nutrition'
         AND base_product.active = 1 AND ingredient_product.active = 1
         AND base.active = 1 AND ingredient.active = 1
         AND base.sort_order = 1 AND ingredient.sort_order = 1
         AND base.weight_grams = 25000 AND ingredient.weight_grams = 25000
       ORDER BY base.id, ingredient.id
       LIMIT 1`,
    )
    .get() as (Lot & { ingredient_id: number }) | undefined;
  assert.ok(pair, 'seed must expose a blendable country-blocked ingredient');
  const pinnedBase = pin(db, pair, { stock: 1_000, moqSacks: 1, priceCents: 1_000 });
  db.prepare(
    `UPDATE product_variants
     SET price_cents = ?, clearance_price_cents = NULL,
         clearance_starts_at = NULL, clearance_ends_at = NULL
     WHERE id = ?`,
  ).run(10_000, pair.ingredient_id);
  const { snapshot, resolvedUnitPriceCents } = await createPersistedBlend(
    app,
    db,
    pinnedBase,
    pair.ingredient_id,
  );
  const orderId = placeOrder(orders, ALICE_USER_ID, [
    {
      ...line(pinnedBase, 4, pinnedBase.price_cents),
      blendingFeeCents: snapshot.blendingFeeCents,
      customBlend: snapshot,
    },
  ]);

  const cookie = await login(app, ALICE);
  const created = await app.inject({
    method: 'POST',
    url: '/api/cart',
    payload: { country: 'CN' },
  });
  const cartId = Value.Parse(CreateCartResponse, created.json()).cartId;
  const report = await reorderOk(app, cookie, orderId, cartId);
  assert.equal(report.outcomes[0]?.status, 'skipped');
  assert.equal(report.outcomes[0]?.reason, 'BLOCKED_IN_COUNTRY');
  assert.equal(report.outcomes[0]?.currentUnitPriceCents, resolvedUnitPriceCents);
  assert.equal(report.outcomes[0]?.priceChanged, true);
  assert.deepEqual(report.cart.items, []);
});

void test('reorder reports a stale legacy Custom Blend specification as unavailable', async (t) => {
  const fixture = await openFixture('reorder-stale-blend');
  t.after(fixture.cleanup);
  const { db, app, orders } = fixture;
  const base = db
    .prepare(
      `SELECT pv.id, pv.product_id, pv.sku, pv.label, pv.weight_grams, pv.price_cents,
              pv.moq_sacks, pv.delivery_class, p.consumption_classification
       FROM product_variants pv INNER JOIN products p ON p.id = pv.product_id
       WHERE p.active = 1 AND pv.active = 1 AND pv.sort_order = 1 AND pv.weight_grams = 25000
         AND p.mixing_group = 'cleaning'
       ORDER BY pv.id LIMIT 1`,
    )
    .get() as Lot | undefined;
  const ingredient = db
    .prepare(
      `SELECT pv.id, pv.product_id, pv.sku, pv.label, pv.weight_grams, pv.price_cents,
              pv.moq_sacks, pv.delivery_class, p.consumption_classification
       FROM product_variants pv INNER JOIN products p ON p.id = pv.product_id
       WHERE p.active = 1 AND pv.active = 1 AND pv.sort_order = 1 AND pv.weight_grams = 25000
         AND p.mixing_group = 'pigments'
       ORDER BY pv.id LIMIT 1`,
    )
    .get() as Lot | undefined;
  assert.ok(base);
  assert.ok(ingredient);
  const pinnedBase = pin(db, base, { stock: 1_000, moqSacks: 1 });

  const scratchCartId = await createCart(app);
  const configured = await app.inject({
    method: 'POST',
    url: `/api/cart/${scratchCartId}/custom-blends`,
    payload: {
      baseVariantId: pinnedBase.id,
      ingredients: [{ variantId: ingredient.id, percentage: 5 }],
      quantity: 4,
    },
  });
  assert.equal(configured.statusCode, 200, configured.body);
  const stored = db
    .prepare("SELECT custom_blend_json FROM cart_line_items WHERE cart_id = ? AND config_key <> ''")
    .get(scratchCartId) as { custom_blend_json: string } | undefined;
  assert.ok(stored);
  const snapshot = parsePersistedCustomBlend(stored.custom_blend_json);
  const orderId = placeOrder(orders, ALICE_USER_ID, [
    {
      ...line(pinnedBase, 4),
      blendingFeeCents: snapshot.blendingFeeCents,
      customBlend: snapshot,
    },
  ]);
  db.prepare('UPDATE product_variants SET active = 0 WHERE id = ?').run(ingredient.id);

  const cookie = await login(app, ALICE);
  const cartId = await createCart(app);
  const report = await reorderOk(app, cookie, orderId, cartId);
  assert.equal(report.addedLineCount, 0);
  assert.equal(report.skippedLineCount, 1);
  assert.equal(report.outcomes[0]?.status, 'skipped');
  assert.equal(report.outcomes[0]?.reason, 'BLEND_UNAVAILABLE');
  assert.equal(report.outcomes[0]?.configKey, snapshot.configKey);
  assert.equal(report.outcomes[0]?.currentUnitPriceCents, null);
  assert.equal(report.outcomes[0]?.priceChanged, false);
  assert.deepEqual(report.cart.items, []);
  assert.deepEqual(
    db.prepare('SELECT variant_id, config_key FROM cart_line_items WHERE cart_id = ?').all(cartId),
    [],
  );
});
