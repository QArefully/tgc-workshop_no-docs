import assert from 'node:assert/strict';
import test from 'node:test';
import { createSeededAppFixture } from '../support/seededDatabase.js';

void test('bundle HTTP routes validate input, expose current bundles, and audit anonymous adds', async (t) => {
  const fixture = await createSeededAppFixture(t);
  const { db, app } = fixture;

  const listed = await app.inject({ method: 'GET', url: '/api/bundles?productId=1' });
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(
    listed.json<Array<{ key: string }>>().map((bundle) => bundle.key),
    ['baking-essentials'],
  );
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/bundles?productId=not-a-number' })).statusCode,
    400,
  );

  const created = await app.inject({ method: 'POST', url: '/api/cart' });
  const { cartId } = created.json<{ cartId: string }>();
  const malformed = await app.inject({
    method: 'POST',
    url: `/api/cart/${cartId}/bundles`,
    payload: { bundleId: '1', quantity: 3 },
  });
  assert.equal(malformed.statusCode, 400);

  const missingBundle = await app.inject({
    method: 'POST',
    url: `/api/cart/${cartId}/bundles`,
    payload: { bundleId: '9999' },
  });
  assert.equal(missingBundle.json<{ code: string }>().code, 'BUNDLE_NOT_FOUND');
  assert.equal(missingBundle.statusCode, 404);

  const added = await app.inject({
    method: 'POST',
    url: `/api/cart/${cartId}/bundles`,
    payload: { bundleId: '1' },
  });
  assert.equal(added.statusCode, 200);
  assert.deepEqual(
    added
      .json<{ items: Array<{ productId: string; quantity: number }> }>()
      .items.map((item) => [item.productId, item.quantity]),
    [
      ['8', 4],
      ['9', 4],
      ['13', 4],
    ],
  );
  const audit = db
    .prepare(
      `SELECT actor_type, actor_user_id, action, entity_type, entity_id, request_id, metadata_json
       FROM audit_events WHERE action = 'cart.bundle_added'`,
    )
    .get() as {
    actor_type: string;
    actor_user_id: number | null;
    action: string;
    entity_type: string;
    entity_id: string;
    request_id: string;
    metadata_json: string;
  };
  assert.equal(audit.actor_type, 'anonymous');
  assert.equal(audit.actor_user_id, null);
  assert.equal(audit.action, 'cart.bundle_added');
  assert.equal(audit.entity_type, 'cart');
  assert.equal(audit.entity_id, cartId);
  assert.ok(audit.request_id.length > 0);
  assert.equal(audit.metadata_json, '{"bundleId":1,"componentCount":3,"quantity":12}');
});

void test('bundle HTTP add maps unavailable and reserved-cart conflicts', async (t) => {
  const fixture = await createSeededAppFixture(t);
  const { db, app } = fixture;

  const unavailableCart = (await app.inject({ method: 'POST', url: '/api/cart' })).json<{
    cartId: string;
  }>();
  const unavailableVariant = db
    .prepare(
      'SELECT id FROM product_variants WHERE product_id = 8 AND sort_order = 1 AND active = 1 LIMIT 1',
    )
    .get() as { id: number };
  db.prepare('UPDATE product_variants SET stock_count = 0 WHERE id = ?').run(unavailableVariant.id);
  const unavailable = await app.inject({
    method: 'POST',
    url: `/api/cart/${unavailableCart.cartId}/bundles`,
    payload: { bundleId: '1' },
  });
  assert.equal(unavailable.statusCode, 409);
  assert.deepEqual(unavailable.json<{ code: string; meta?: { variantIds?: string[] } }>(), {
    code: 'BUNDLE_UNAVAILABLE',
    error: 'One or more bundle components are unavailable.',
    meta: { variantIds: [String(unavailableVariant.id)] },
  });

  const reservedCart = (await app.inject({ method: 'POST', url: '/api/cart' })).json<{
    cartId: string;
  }>();
  db.pragma('foreign_keys = OFF');
  db.prepare(
    'INSERT INTO cart_reservations (cart_id, payment_idempotency_key, created_at) VALUES (?, ?, ?)',
  ).run(reservedCart.cartId, 'http-bundle-reservation', '2026-07-18T12:00:00.000Z');
  const reserved = await app.inject({
    method: 'POST',
    url: `/api/cart/${reservedCart.cartId}/bundles`,
    payload: { bundleId: '1' },
  });
  assert.equal(reserved.statusCode, 409);
  assert.equal(reserved.json<{ code: string }>().code, 'CART_RESERVED');
});
