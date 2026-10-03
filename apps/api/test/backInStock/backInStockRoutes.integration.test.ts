import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import type Database from 'better-sqlite3';
import {
  BackInStockSubscription,
  BackInStockSubscriptionListResponse,
} from '@shop/contracts/back-in-stock';
import { buildApp } from '../../src/app.js';
import { createSeededAppFixture } from '../support/seededDatabase.js';

/** The seeded sold-out lot. Resolved by SKU because surrogate ids shift between seeds. */
const SOLD_OUT_SKU = 'TCM-0034-002';
const SUBSCRIBER_EMAIL = 'alice@example.com';

function cookie(response: { headers: Record<string, string | string[] | undefined> }): string {
  const value = response.headers['set-cookie'];
  const header = Array.isArray(value) ? value[0] : value;
  if (!header) throw new Error('Expected session cookie');
  return header.split(';', 1)[0]!;
}

async function login(app: Awaited<ReturnType<typeof buildApp>>, email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/login',
    payload: { email, password: 'Password123!', country: 'UK' },
  });
  assert.equal(response.statusCode, 200, response.body);
  return cookie(response);
}

async function signup(app: Awaited<ReturnType<typeof buildApp>>, email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/signup',
    payload: { email, password: 'password-one', displayName: 'Buyer', country: 'UK' },
  });
  assert.equal(response.statusCode, 201, response.body);
  return cookie(response);
}

function variantIdBySku(db: Database.Database, sku: string): number {
  const row = db.prepare('SELECT id FROM product_variants WHERE sku = ?').get(sku) as
    { id: number } | undefined;
  if (!row) throw new Error(`Missing fixture variant ${sku}`);
  return row.id;
}

function userIdByEmail(db: Database.Database, email: string): number {
  const row = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as
    { id: number } | undefined;
  if (!row) throw new Error(`Missing fixture user ${email}`);
  return row.id;
}

void test('back-in-stock routes enforce auth, map every error code, and isolate ownership', async (t) => {
  const fixture = await createSeededAppFixture(t);
  const { db, app } = fixture;

  const soldOutVariantId = variantIdBySku(db, SOLD_OUT_SKU);

  // --- anonymous access is refused on every route -------------------------------------------
  for (const request of [
    { method: 'GET' as const, url: '/api/back-in-stock' },
    {
      method: 'POST' as const,
      url: '/api/back-in-stock',
      payload: { variantId: soldOutVariantId },
    },
    { method: 'DELETE' as const, url: '/api/back-in-stock/1' },
  ]) {
    assert.equal((await app.inject(request)).statusCode, 401, `${request.method} ${request.url}`);
  }

  const alice = await login(app, SUBSCRIBER_EMAIL);

  // --- the seeded pending subscription is visible to its owner and schema-valid ---------------
  const listed = await app.inject({
    method: 'GET',
    url: '/api/back-in-stock',
    headers: { cookie: alice },
  });
  assert.equal(listed.statusCode, 200, listed.body);
  const subscriptions = Value.Parse(BackInStockSubscriptionListResponse, listed.json());
  assert.equal(subscriptions.length, 1);
  const seeded = subscriptions[0]!;
  assert.equal(seeded.sku, SOLD_OUT_SKU);
  assert.equal(seeded.variantId, soldOutVariantId);
  assert.equal(seeded.status, 'pending');
  assert.equal(seeded.notifiedAt, null);
  assert.equal(seeded.minimumOrderQuantity, 1);

  const pendingOnly = await app.inject({
    method: 'GET',
    url: '/api/back-in-stock?status=pending',
    headers: { cookie: alice },
  });
  assert.equal(pendingOnly.statusCode, 200, pendingOnly.body);
  assert.equal(Value.Parse(BackInStockSubscriptionListResponse, pendingOnly.json()).length, 1);
  const notifiedOnly = await app.inject({
    method: 'GET',
    url: '/api/back-in-stock?status=notified',
    headers: { cookie: alice },
  });
  assert.equal(notifiedOnly.statusCode, 200, notifiedOnly.body);
  assert.deepEqual(Value.Parse(BackInStockSubscriptionListResponse, notifiedOnly.json()), []);

  const badStatus = await app.inject({
    method: 'GET',
    url: '/api/back-in-stock?status=nonsense',
    headers: { cookie: alice },
  });
  assert.equal(badStatus.statusCode, 400, badStatus.body);

  // --- ALREADY_SUBSCRIBED --------------------------------------------------------------------
  const duplicate = await app.inject({
    method: 'POST',
    url: '/api/back-in-stock',
    headers: { cookie: alice },
    payload: { variantId: soldOutVariantId },
  });
  assert.equal(duplicate.statusCode, 409, duplicate.body);
  assert.equal(duplicate.json<{ code: string }>().code, 'ALREADY_SUBSCRIBED');

  // --- VARIANT_NOT_FOUND ---------------------------------------------------------------------
  const missing = await app.inject({
    method: 'POST',
    url: '/api/back-in-stock',
    headers: { cookie: alice },
    payload: { variantId: 999_999_999 },
  });
  assert.equal(missing.statusCode, 404, missing.body);
  assert.equal(missing.json<{ code: string }>().code, 'VARIANT_NOT_FOUND');

  // --- VARIANT_AVAILABLE ---------------------------------------------------------------------
  const stockedVariantId = (
    db
      .prepare(
        `SELECT id FROM product_variants
         WHERE active = 1 AND stock_count >= 10 AND id != ? ORDER BY id ASC LIMIT 1`,
      )
      .get(soldOutVariantId) as { id: number }
  ).id;
  const available = await app.inject({
    method: 'POST',
    url: '/api/back-in-stock',
    headers: { cookie: alice },
    payload: { variantId: stockedVariantId },
  });
  assert.equal(available.statusCode, 409, available.body);
  assert.equal(available.json<{ code: string }>().code, 'VARIANT_AVAILABLE');

  // --- VARIANT_RETIRED -----------------------------------------------------------------------
  const retiredVariantId = (
    db
      .prepare(
        `SELECT id FROM product_variants
         WHERE active = 1 AND id NOT IN (?, ?) ORDER BY id DESC LIMIT 1`,
      )
      .get(soldOutVariantId, stockedVariantId) as { id: number }
  ).id;
  db.prepare('UPDATE product_variants SET active = 0 WHERE id = ?').run(retiredVariantId);
  const retired = await app.inject({
    method: 'POST',
    url: '/api/back-in-stock',
    headers: { cookie: alice },
    payload: { variantId: retiredVariantId },
  });
  assert.equal(retired.statusCode, 409, retired.body);
  assert.equal(retired.json<{ code: string }>().code, 'VARIANT_RETIRED');

  // --- ownership isolation across two buyers -------------------------------------------------
  const bob = await signup(app, 'back-in-stock-bob@example.test');
  const bobList = await app.inject({
    method: 'GET',
    url: '/api/back-in-stock',
    headers: { cookie: bob },
  });
  assert.equal(bobList.statusCode, 200, bobList.body);
  assert.deepEqual(Value.Parse(BackInStockSubscriptionListResponse, bobList.json()), []);

  const bobCancelsAlice = await app.inject({
    method: 'DELETE',
    url: `/api/back-in-stock/${seeded.subscriptionId}`,
    headers: { cookie: bob },
  });
  assert.equal(bobCancelsAlice.statusCode, 404, bobCancelsAlice.body);
  assert.equal(bobCancelsAlice.json<{ code: string }>().code, 'SUBSCRIPTION_NOT_FOUND');

  // Alice's row survived Bob's attempt untouched.
  const aliceStill = await app.inject({
    method: 'GET',
    url: '/api/back-in-stock',
    headers: { cookie: alice },
  });
  assert.equal(
    Value.Parse(BackInStockSubscriptionListResponse, aliceStill.json())[0]!.status,
    'pending',
  );

  // --- the owner may cancel exactly once -----------------------------------------------------
  const cancelled = await app.inject({
    method: 'DELETE',
    url: `/api/back-in-stock/${seeded.subscriptionId}`,
    headers: { cookie: alice },
  });
  assert.equal(cancelled.statusCode, 200, cancelled.body);
  assert.deepEqual(cancelled.json(), { success: true });
  const afterCancel = await app.inject({
    method: 'GET',
    url: '/api/back-in-stock',
    headers: { cookie: alice },
  });
  assert.equal(
    Value.Parse(BackInStockSubscriptionListResponse, afterCancel.json())[0]!.status,
    'cancelled',
  );

  // --- SUBSCRIPTION_NOT_FOUND on a second cancel and on an unknown id ------------------------
  const recancel = await app.inject({
    method: 'DELETE',
    url: `/api/back-in-stock/${seeded.subscriptionId}`,
    headers: { cookie: alice },
  });
  assert.equal(recancel.statusCode, 404, recancel.body);
  assert.equal(recancel.json<{ code: string }>().code, 'SUBSCRIPTION_NOT_FOUND');
  const unknown = await app.inject({
    method: 'DELETE',
    url: '/api/back-in-stock/987654321',
    headers: { cookie: alice },
  });
  assert.equal(unknown.statusCode, 404, unknown.body);
  assert.equal(unknown.json<{ code: string }>().code, 'SUBSCRIPTION_NOT_FOUND');
  const malformed = await app.inject({
    method: 'DELETE',
    url: '/api/back-in-stock/not-a-number',
    headers: { cookie: alice },
  });
  assert.equal(malformed.statusCode, 400, malformed.body);

  // --- a successful subscribe returns 201 and the contract shape -----------------------------
  const created = await app.inject({
    method: 'POST',
    url: '/api/back-in-stock',
    headers: { cookie: bob },
    payload: { variantId: soldOutVariantId },
  });
  assert.equal(created.statusCode, 201, created.body);
  const subscription = Value.Parse(BackInStockSubscription, created.json());
  assert.equal(subscription.status, 'pending');
  assert.equal(subscription.variantId, soldOutVariantId);
  assert.equal(subscription.sku, SOLD_OUT_SKU);

  // --- SUBSCRIPTION_LIMIT_REACHED ------------------------------------------------------------
  // Bob already holds one pending row; 49 more take him to the limit of 50.
  const bobId = userIdByEmail(db, 'back-in-stock-bob@example.test');
  const filler = db
    .prepare(`SELECT id FROM product_variants WHERE id NOT IN (?, ?) ORDER BY id ASC LIMIT 50`)
    .all(soldOutVariantId, retiredVariantId) as { id: number }[];
  assert.ok(filler.length >= 50, 'fixture needs 50 spare variants');
  const insert = db.prepare(
    `INSERT INTO back_in_stock_subscriptions
       (user_id, variant_id, status, requested_at, created_at, updated_at)
     VALUES (?, ?, 'pending', '2026-08-02T09:00:00.000Z', '2026-08-02T09:00:00.000Z',
             '2026-08-02T09:00:00.000Z')`,
  );
  // The 50th spare variant is the one Bob will try to subscribe to, so only 49 become filler.
  const limitTargetId = filler[49]!.id;
  for (const row of filler.slice(0, 49)) insert.run(bobId, row.id);
  db.prepare('UPDATE product_variants SET stock_count = 0 WHERE id = ?').run(limitTargetId);

  const limited = await app.inject({
    method: 'POST',
    url: '/api/back-in-stock',
    headers: { cookie: bob },
    payload: { variantId: limitTargetId },
  });
  assert.equal(limited.statusCode, 409, limited.body);
  assert.equal(limited.json<{ code: string }>().code, 'SUBSCRIPTION_LIMIT_REACHED');
});
