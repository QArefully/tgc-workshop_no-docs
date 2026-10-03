import assert from 'node:assert/strict';
import test from 'node:test';
import type Database from 'better-sqlite3';
import { Value } from '@sinclair/typebox/value';
import { CreateCartResponse } from '@shop/contracts/cart';
import { SACK_WEIGHT_GRAMS } from '@shop/contracts/pricing';
import {
  QuickOrderResponse,
  type QuickOrderResponse as QuickOrderResponseType,
} from '@shop/contracts/quick-order';
import { createSeededAppFixture } from '../support/seededDatabase.js';
import { createCartRepository } from '../../src/features/cart/cartRepository.js';

const NOW = new Date('2026-07-31T12:00:00.000Z');
const ALICE = 'alice@example.com';

type App = Awaited<ReturnType<typeof createSeededAppFixture>>['app'];

interface Fixture {
  db: Database.Database;
  app: App;
  cleanup: () => Promise<void>;
}

interface SeedLot {
  id: number;
  product_id: number;
  product_name: string;
  sku: string;
  stock_count: number;
  moq_sacks: number;
  weight_grams: number;
  active: number;
  clearance_price_cents: number | null;
  clearance_starts_at: string | null;
  clearance_ends_at: string | null;
}

async function openFixture(name: string): Promise<Fixture> {
  void name;
  return createSeededAppFixture({ app: { clock: { now: () => NOW } } });
}

async function createCart(app: App): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/cart' });
  assert.equal(response.statusCode, 201);
  return Value.Parse(CreateCartResponse, response.json()).cartId;
}

function cookieValue(response: { headers: Record<string, string | string[] | undefined> }): string {
  const header = response.headers['set-cookie'];
  const cookie = Array.isArray(header) ? header[0] : header;
  if (!cookie) throw new Error('Expected set-cookie header');
  return cookie.split(';', 1)[0]!;
}

async function login(app: App): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/login',
    payload: { email: ALICE, password: 'Password123!', country: 'UK' },
  });
  assert.equal(response.statusCode, 200);
  return cookieValue(response);
}

async function quickOrder(
  app: App,
  cartId: string,
  text: string,
  cookie?: string,
): Promise<{ statusCode: number; body: unknown }> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/cart/${cartId}/quick-order`,
    headers: cookie ? { cookie } : undefined,
    payload: { text },
  });
  return { statusCode: response.statusCode, body: response.json() };
}

function seedLots(db: Database.Database): Record<'garden' | 'sports' | 'baking', SeedLot> {
  const rows = db
    .prepare(
      `SELECT v.id, v.product_id, p.name AS product_name, v.sku, v.stock_count, v.moq_sacks,
              v.weight_grams, v.active, v.clearance_price_cents, v.clearance_starts_at,
              v.clearance_ends_at
       FROM product_variants v
       INNER JOIN products p ON p.id = v.product_id
       WHERE v.sku IN ('GDN-1043-001', 'SPN-1007-001', 'BKP-0001-001')`,
    )
    .all() as SeedLot[];
  assert.equal(rows.length, 3, 'seed must retain the Quick Order fixture lots');
  const bySku = new Map(rows.map((row) => [row.sku, row]));
  return {
    garden: bySku.get('GDN-1043-001')!,
    sports: bySku.get('SPN-1007-001')!,
    baking: bySku.get('BKP-0001-001')!,
  };
}

function assertQuickOrderResponse(body: unknown): asserts body is QuickOrderResponseType {
  if (!Value.Check(QuickOrderResponse, body)) {
    const first = [...Value.Errors(QuickOrderResponse, body)][0];
    assert.fail(`QuickOrderResponse violation at ${first?.path ?? '/'}: ${first?.message ?? '?'}`);
  }
}

function minimumQuantity(weightGrams: number, moqSacks: number): number {
  return Math.ceil((moqSacks * SACK_WEIGHT_GRAMS) / weightGrams);
}

void test('quick order returns mixed per-line outcomes, aggregates duplicates, and audits an anonymous buyer', async (t) => {
  const fixture = await openFixture('mixed');
  t.after(fixture.cleanup);
  const { db, app } = fixture;
  const { garden, sports, baking } = seedLots(db);

  // G0 facts: Lawn Feed is a live clearance lot; HMB has 15 units and flour has 85.
  assert.equal(garden.active, 1);
  assert.equal(garden.stock_count, 35);
  assert.ok(garden.clearance_price_cents !== null);
  assert.ok(garden.clearance_starts_at! < NOW.toISOString());
  assert.ok(garden.clearance_ends_at! > NOW.toISOString());
  assert.equal(sports.stock_count, 15);
  assert.equal(baking.stock_count, 85);
  assert.deepEqual(
    db.prepare('SELECT sku FROM product_variants WHERE active = 0 ORDER BY sku').pluck().all(),
    ['SPN-0009-002'],
    'the saved-list seed retires exactly one lot, and none of the lots used below',
  );

  // Local retirement is intentional: route coverage must retain the persisted-retired outcome
  // that a buyer can encounter after a catalog update, independent of the seeded retired lot.
  const retired = db
    .prepare(
      `SELECT id, sku FROM product_variants
       WHERE active = 1 AND sku NOT IN ('GDN-1043-001', 'SPN-1007-001', 'BKP-0001-001')
       ORDER BY id LIMIT 1`,
    )
    .get() as { id: number; sku: string };
  db.prepare('UPDATE product_variants SET active = 0 WHERE id = ?').run(retired.id);
  // The local MOQ forces a round-up; duplicate source lines first aggregate to 2.
  db.prepare('UPDATE product_variants SET moq_sacks = 4 WHERE id = ?').run(garden.id);
  const gardenMoqQuantity = minimumQuantity(garden.weight_grams, 4);

  const cartId = await createCart(app);
  const result = await quickOrder(
    app,
    cartId,
    [
      'GDN-1043-001, 1',
      'gdn-1043-001, 1',
      'SPN-1007-001, 16',
      'BKP-0001-001, 4',
      `${retired.sku}, 1`,
      'UNKNOWN-0000-001, 2',
      'this line is malformed',
    ].join('\n'),
  );
  assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  assertQuickOrderResponse(result.body);

  assert.equal(result.body.addedLineCount, 3);
  assert.equal(result.body.skippedLineCount, 4);
  assert.deepEqual(
    result.body.outcomes.map((outcome) => [outcome.status, outcome.reason]),
    [
      ['added', null],
      ['added', null],
      ['skipped', 'INSUFFICIENT_STOCK'],
      ['added', null],
      ['skipped', 'VARIANT_RETIRED'],
      ['skipped', 'SKU_NOT_FOUND'],
      ['skipped', 'MALFORMED_LINE'],
    ],
  );
  for (const outcome of result.body.outcomes.slice(0, 2)) {
    assert.equal(outcome.submittedQuantity, gardenMoqQuantity);
    assert.equal(outcome.moqAdjusted, true);
    assert.equal(outcome.duplicateSku, true);
    assert.ok(outcome.resolvedUnitPriceCents !== null);
  }
  assert.deepEqual(
    (
      db
        .prepare(
          'SELECT variant_id, quantity FROM cart_line_items WHERE cart_id = ? ORDER BY variant_id',
        )
        .all(cartId) as Array<{ variant_id: number; quantity: number }>
    ).map((row) => [row.variant_id, row.quantity]),
    [
      [baking.id, 4],
      [garden.id, gardenMoqQuantity],
    ].sort((left, right) => left[0] - right[0]),
  );
  assert.equal(result.body.cart.totalItems, gardenMoqQuantity + 4);
  assert.deepEqual(
    db
      .prepare(
        `SELECT actor_type, actor_user_id, metadata_json FROM audit_events
         WHERE action = 'cart.quick_order_added' AND entity_id = ?`,
      )
      .all(cartId),
    [
      {
        actor_type: 'anonymous',
        actor_user_id: null,
        metadata_json: '{"lineCount":7,"addedLineCount":3,"skippedLineCount":4}',
      },
    ],
  );
});

void test('MOQ round-up can itself exceed available stock without mutating the cart', async (t) => {
  const fixture = await openFixture('moq-stock');
  t.after(fixture.cleanup);
  const { db, app } = fixture;
  const { garden } = seedLots(db);
  assert.equal(garden.stock_count, 35);
  const gardenMoqQuantity = minimumQuantity(garden.weight_grams, 4);
  db.prepare('UPDATE product_variants SET moq_sacks = 4, stock_count = ? WHERE id = ?').run(
    gardenMoqQuantity - 1,
    garden.id,
  );
  const cartId = await createCart(app);

  const result = await quickOrder(app, cartId, 'GDN-1043-001, 2');
  assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  assertQuickOrderResponse(result.body);
  assert.equal(result.body.addedLineCount, 0);
  assert.equal(result.body.skippedLineCount, 1);
  assert.deepEqual(result.body.outcomes[0], {
    lineNumber: 1,
    rawLine: 'GDN-1043-001, 2',
    sku: 'GDN-1043-001',
    requestedQuantity: 2,
    submittedQuantity: gardenMoqQuantity,
    moqAdjusted: true,
    duplicateSku: false,
    variantId: garden.id,
    productId: String(garden.product_id),
    productName: garden.product_name,
    resolvedUnitPriceCents: null,
    status: 'skipped',
    reason: 'INSUFFICIENT_STOCK',
  });
  assert.deepEqual(
    db.prepare('SELECT variant_id, quantity FROM cart_line_items WHERE cart_id = ?').all(cartId),
    [],
  );
  assert.equal(result.body.cart.totalItems, 0);
});

void test('quick order maps whole-request failures with exact code, status, and prose', async (t) => {
  const fixture = await openFixture('failures');
  t.after(fixture.cleanup);
  const { db, app } = fixture;
  const cartId = await createCart(app);

  const empty = await quickOrder(app, cartId, ' \n\t ');
  assert.equal(empty.statusCode, 400);
  assert.equal((empty.body as { code: string }).code, 'NO_INPUT_LINES');

  const tooMany = await quickOrder(
    app,
    cartId,
    Array.from({ length: 201 }, () => 'BKP-0001-001, 1').join('\n'),
  );
  assert.equal(tooMany.statusCode, 400);
  assert.equal((tooMany.body as { code: string }).code, 'TOO_MANY_LINES');
  assert.deepEqual((tooMany.body as { meta?: { lineCount?: number } }).meta, { lineCount: 201 });

  const missing = await quickOrder(app, '00000000-0000-4000-8000-000000000000', 'BKP-0001-001, 1');
  assert.equal(missing.statusCode, 404);
  assert.equal((missing.body as { code: string }).code, 'CART_NOT_FOUND');

  const reservationKey = 'quick-order-reservation';
  db.prepare(
    `INSERT INTO payments
      (idempotency_key, request_fingerprint, status, amount_cents, card_last4, card_brand,
       reservation_expires_at)
     VALUES (?, ?, 'prepared', 1, '4242', 'Visa', '2026-08-01T12:00:00.000Z')`,
  ).run(reservationKey, reservationKey);
  assert.equal(createCartRepository(db).reserve(cartId, reservationKey, NOW.toISOString()), true);
  const reserved = await quickOrder(app, cartId, 'BKP-0001-001, 1');
  assert.equal(reserved.statusCode, 409);
  assert.equal((reserved.body as { code: string }).code, 'CART_RESERVED');
  assert.deepEqual(
    db.prepare('SELECT variant_id, quantity FROM cart_line_items WHERE cart_id = ?').all(cartId),
    [],
  );
  assert.equal(
    (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'cart.quick_order_added'",
        )
        .get() as {
        count: number;
      }
    ).count,
    0,
  );
});

void test('quick order records the signed-in buyer as the audit actor without requiring a session', async (t) => {
  const fixture = await openFixture('authenticated');
  t.after(fixture.cleanup);
  const { db, app } = fixture;
  const cartId = await createCart(app);
  const result = await quickOrder(app, cartId, 'BKP-0001-001, 1', await login(app));
  assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  assertQuickOrderResponse(result.body);
  assert.deepEqual(
    db
      .prepare(
        `SELECT actor_type, actor_user_id, metadata_json FROM audit_events
         WHERE action = 'cart.quick_order_added' AND entity_id = ?`,
      )
      .all(cartId),
    [
      {
        actor_type: 'user',
        actor_user_id: 1,
        metadata_json: '{"lineCount":1,"addedLineCount":1,"skippedLineCount":0}',
      },
    ],
  );
});
