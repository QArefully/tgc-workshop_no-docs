import assert from 'node:assert/strict';
import test from 'node:test';
import type { Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type Database from 'better-sqlite3';
import {
  BackInStockSubscription,
  BackInStockSubscriptionListResponse,
} from '@shop/contracts/back-in-stock';
import { AdminJobDrainResponse } from '@shop/contracts/jobs';
import { InventoryReceiptResponse } from '@shop/contracts/inventory';
import { MailboxListResponse } from '@shop/contracts/mailbox';
import { NotificationPage } from '@shop/contracts/notifications';
import { buildApp } from '../../src/app.js';
import { createSeededAppFixture } from '../support/seededDatabase.js';

/** Resolved by SKU and email: `resetDatabase` does not rewind SQLite AUTOINCREMENT. */
const SOLD_OUT_SKU = 'TCM-0034-002';
const BUYER_EMAIL = 'alice@example.com';
const ADMIN_EMAIL = 'admin@example.com';
const FAULT_KEY = 'async.back_in_stock_failure';

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

function variantIdBySku(db: Database.Database, sku: string): number {
  const row = db.prepare('SELECT id FROM product_variants WHERE sku = ?').get(sku) as
    { id: number } | undefined;
  if (!row) throw new Error(`Missing fixture variant ${sku}`);
  return row.id;
}

void test('a restock above MOQ notifies every waiting buyer exactly once', async (t) => {
  let now = new Date('2026-08-02T10:00:00.000Z');
  const fixture = await createSeededAppFixture({
    testContext: t,
    app: { clock: { now: () => now } },
  });
  const { db, app } = fixture;

  // Park every pre-seeded async scenario job so drain counts describe only this test's work.
  db.prepare("UPDATE jobs SET run_at='2099-01-01T00:00:00.000Z' WHERE status='pending'").run();

  const buyer = await login(app, BUYER_EMAIL);
  const admin = await login(app, ADMIN_EMAIL);
  const variantId = variantIdBySku(db, SOLD_OUT_SKU);

  const drain = async (): Promise<{
    processedCount: number;
    succeededCount: number;
    failedCount: number;
  }> => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/jobs/run',
      headers: { cookie: admin },
    });
    assert.equal(response.statusCode, 200, response.body);
    return Value.Parse(AdminJobDrainResponse, response.json());
  };
  const subscriptions = async (): Promise<Static<typeof BackInStockSubscriptionListResponse>> => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/back-in-stock',
      headers: { cookie: buyer },
    });
    assert.equal(response.statusCode, 200, response.body);
    return Value.Parse(BackInStockSubscriptionListResponse, response.json());
  };
  const backInStockNotifications = async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/notifications?pageSize=100',
      headers: { cookie: buyer },
    });
    assert.equal(response.statusCode, 200, response.body);
    return Value.Parse(NotificationPage, response.json()).items.filter(
      (item) => item.kind === 'back_in_stock.available',
    );
  };
  const restockMails = async () => {
    const response = await app.inject({ method: 'GET', url: '/api/dev/mailbox' });
    assert.equal(response.statusCode, 200, response.body);
    return Value.Parse(MailboxListResponse, response.json()).filter((message) =>
      message.subject.startsWith('Back in stock:'),
    );
  };
  const receive = async (targetVariantId: number, quantity: number, key: string) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/inventory/receipts',
      headers: { cookie: admin },
      payload: { variantId: targetVariantId, quantity, idempotencyKey: key },
    });
    assert.equal(response.statusCode, 201, response.body);
    return Value.Parse(InventoryReceiptResponse, response.json());
  };

  // --- the buyer expresses interest through the public route --------------------------------
  // The seeded pending row is withdrawn first so exactly one subscription exists for this lot.
  const seeded = (await subscriptions())[0]!;
  assert.equal(seeded.variantId, variantId);
  assert.equal(seeded.status, 'pending');
  const withdrawn = await app.inject({
    method: 'DELETE',
    url: `/api/back-in-stock/${seeded.subscriptionId}`,
    headers: { cookie: buyer },
  });
  assert.equal(withdrawn.statusCode, 200, withdrawn.body);

  const created = await app.inject({
    method: 'POST',
    url: '/api/back-in-stock',
    headers: { cookie: buyer },
    payload: { variantId },
  });
  assert.equal(created.statusCode, 201, created.body);
  const subscription = Value.Parse(BackInStockSubscription, created.json());
  assert.equal(subscription.status, 'pending');
  assert.equal(subscription.minimumOrderQuantity, 1);
  assert.equal(
    Number(
      db
        .prepare(
          "SELECT COUNT(*) FROM back_in_stock_subscriptions WHERE variant_id=? AND status='pending'",
        )
        .pluck()
        .get(variantId),
    ),
    1,
  );

  // Nothing is queued and nobody is notified until stock actually moves.
  assert.deepEqual(await drain(), { processedCount: 0, succeededCount: 0, failedCount: 0 });
  assert.equal((await backInStockNotifications()).length, 0);

  // --- admin goods receipt lifts the lot above its MOQ --------------------------------------
  now = new Date('2026-08-02T11:00:00.000Z');
  const receipt = await receive(variantId, 5, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.equal(receipt.remainingStock, 5);
  assert.equal(
    Number(
      db
        .prepare("SELECT COUNT(*) FROM jobs WHERE kind='back_in_stock.notify' AND status='pending'")
        .pluck()
        .get(),
    ),
    1,
  );

  // --- one drain settles the notify job and the delivery job it cascades into ---------------
  const drained = await drain();
  assert.equal(drained.failedCount, 0, JSON.stringify(drained));
  assert.equal(drained.processedCount, 2, JSON.stringify(drained));
  assert.equal(drained.succeededCount, 2, JSON.stringify(drained));

  const notifications = await backInStockNotifications();
  assert.equal(notifications.length, 1, JSON.stringify(notifications));
  assert.equal(notifications[0]!.entityType, 'back_in_stock_subscription');
  assert.equal(notifications[0]!.entityId, subscription.subscriptionId);

  const settled = (await subscriptions()).find(
    (item) => item.subscriptionId === subscription.subscriptionId,
  );
  assert.equal(settled?.status, 'notified');
  assert.notEqual(settled?.notifiedAt, null);
  assert.equal((await restockMails()).length, 1);

  // --- a second drain is a no-op: the interest is terminal ----------------------------------
  assert.deepEqual(await drain(), { processedCount: 0, succeededCount: 0, failedCount: 0 });
  assert.equal((await backInStockNotifications()).length, 1);
  assert.equal((await restockMails()).length, 1);
});

void test('a restock below MOQ notifies nobody, and a faulted run recovers on a later drain', async (t) => {
  let now = new Date('2026-08-02T10:00:00.000Z');
  const fixture = await createSeededAppFixture({
    testContext: t,
    app: { clock: { now: () => now } },
  });
  const { db, app } = fixture;

  db.prepare("UPDATE jobs SET run_at='2099-01-01T00:00:00.000Z' WHERE status='pending'").run();
  const buyer = await login(app, BUYER_EMAIL);
  const admin = await login(app, ADMIN_EMAIL);

  // A 25 kg sack lot: weight 25,000 g against 4 MOQ sacks gives a minimum order quantity of 4,
  // which is what makes a "some stock, still not orderable" receipt expressible at all.
  const sack = db
    .prepare(
      `SELECT id, sku FROM product_variants
       WHERE active = 1 AND weight_grams = 25000 AND moq_sacks = 4 AND sku != ?
       ORDER BY id ASC LIMIT 1`,
    )
    .get(SOLD_OUT_SKU) as { id: number; sku: string };
  db.prepare('UPDATE product_variants SET stock_count = 0 WHERE id = ?').run(sack.id);

  const subscribed = await app.inject({
    method: 'POST',
    url: '/api/back-in-stock',
    headers: { cookie: buyer },
    payload: { variantId: sack.id },
  });
  assert.equal(subscribed.statusCode, 201, subscribed.body);
  const subscription = Value.Parse(BackInStockSubscription, subscribed.json());
  assert.equal(subscription.minimumOrderQuantity, 4);

  const drain = async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/jobs/run',
      headers: { cookie: admin },
    });
    assert.equal(response.statusCode, 200, response.body);
    return Value.Parse(AdminJobDrainResponse, response.json());
  };
  const statusOf = async (): Promise<string> => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/back-in-stock',
      headers: { cookie: buyer },
    });
    assert.equal(response.statusCode, 200, response.body);
    const found = Value.Parse(BackInStockSubscriptionListResponse, response.json()).find(
      (item) => item.subscriptionId === subscription.subscriptionId,
    );
    if (!found) throw new Error('Subscription disappeared');
    return found.status;
  };
  const notifiedCount = async (): Promise<number> => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/notifications?pageSize=100',
      headers: { cookie: buyer },
    });
    assert.equal(response.statusCode, 200, response.body);
    return Value.Parse(NotificationPage, response.json()).items.filter(
      (item) => item.kind === 'back_in_stock.available',
    ).length;
  };
  const receive = async (quantity: number, key: string): Promise<void> => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/inventory/receipts',
      headers: { cookie: admin },
      payload: { variantId: sack.id, quantity, idempotencyKey: key },
    });
    assert.equal(response.statusCode, 201, response.body);
  };

  // --- below the MOQ floor the lot is not orderable, so nobody is told ------------------------
  now = new Date('2026-08-02T11:00:00.000Z');
  await receive(2, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  const belowMoqDrain = await drain();
  assert.equal(belowMoqDrain.processedCount, 1, JSON.stringify(belowMoqDrain));
  assert.equal(belowMoqDrain.failedCount, 0, JSON.stringify(belowMoqDrain));
  assert.equal(await notifiedCount(), 0);
  assert.equal(await statusOf(), 'pending');

  // --- with the fault flag on, the run fails and the interest stays pending -------------------
  const enabled = await app.inject({
    method: 'PATCH',
    url: `/api/admin/feature-flags/${FAULT_KEY}`,
    headers: { cookie: admin },
    payload: { enabled: true },
  });
  assert.equal(enabled.statusCode, 200, enabled.body);

  now = new Date('2026-08-02T12:00:00.000Z');
  await receive(5, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  const faulted = await drain();
  assert.equal(faulted.processedCount, 1, JSON.stringify(faulted));
  assert.equal(faulted.failedCount, 1, JSON.stringify(faulted));
  assert.equal(await notifiedCount(), 0);
  assert.equal(await statusOf(), 'pending');

  // --- once the flag clears and the backoff elapses, a later drain succeeds -------------------
  const disabled = await app.inject({
    method: 'PATCH',
    url: `/api/admin/feature-flags/${FAULT_KEY}`,
    headers: { cookie: admin },
    payload: { enabled: false },
  });
  assert.equal(disabled.statusCode, 200, disabled.body);

  now = new Date('2026-08-02T12:05:00.000Z');
  const recovered = await drain();
  assert.equal(recovered.failedCount, 0, JSON.stringify(recovered));
  assert.equal(recovered.succeededCount, 2, JSON.stringify(recovered));
  assert.equal(await notifiedCount(), 1);
  assert.equal(await statusOf(), 'notified');
});
