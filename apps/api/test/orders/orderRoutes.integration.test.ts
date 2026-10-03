import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../../src/app.js';
import { createOrderRepository } from '../../src/features/orders/orderRepository.js';
import { adhocBilling, adhocDestination, bookableSlot } from '../checkout/checkoutDepthFixtures.js';
import { createSeededFixture } from '../support/seededDatabase.js';

function cookieValue(response: { headers: Record<string, string | string[] | undefined> }): string {
  const header = response.headers['set-cookie'];
  const cookie = Array.isArray(header) ? header[0] : header;
  if (!cookie) throw new Error('Expected set-cookie header');
  return cookie.split(';', 1)[0]!;
}

async function login(app: Awaited<ReturnType<typeof buildApp>>, email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/login',
    payload: { email, password: 'Password123!', country: 'UK' },
  });
  assert.equal(response.statusCode, 200);
  return cookieValue(response);
}

function createOrder(
  repository: ReturnType<typeof createOrderRepository>,
  userId: number | null,
): number {
  return repository.create({
    customerName: 'Route Customer',
    customerEmail: 'route@example.test',
    shippingAddress: '1 Test Street',
    promoApplied: null,
    subtotalCents: 500,
    discountCents: 0,
    totalCents: 500,
    userId,
    items: [
      {
        productId: '1',
        productName: 'Persisted line',
        unitPriceCents: 500,
        quantity: 1,
        discountableTotalCents: 500,
        blendingFeeCents: 0,
        lineTotalCents: 500,
      },
    ],
    createdAt: '2026-07-19T00:00:00.000Z',
  });
}

void test('order routes enforce customer ownership and admin lifecycle authority', async (t) => {
  const { db, app } = await createSeededFixture(t);
  const repository = createOrderRepository(db);
  const aliceOrderId = createOrder(repository, 1);
  const bobOrderId = createOrder(repository, 2);
  const lifecycleOrderId = createOrder(repository, 2);

  const aliceCookie = await login(app, 'alice@example.com');
  const bobCookie = await login(app, 'bob@example.com');
  const adminCookie = await login(app, 'admin@example.com');

  assert.equal((await app.inject({ method: 'GET', url: '/api/orders' })).statusCode, 401);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: `/api/orders/${aliceOrderId}/cancel`,
        payload: { version: 0, idempotencyKey: 'eb27746e-84de-4a22-8349-1bdb15daefb3' },
      })
    ).statusCode,
    401,
  );
  const aliceList = await app.inject({
    method: 'GET',
    url: '/api/orders?page=1&pageSize=50',
    headers: { cookie: aliceCookie },
  });
  assert.equal(aliceList.statusCode, 200);
  const aliceOrderIds = aliceList
    .json<{ items: Array<{ id: string }> }>()
    .items.map((order) => order.id);
  assert.equal(aliceOrderIds[0], String(aliceOrderId));
  assert.equal(aliceOrderIds.includes(String(bobOrderId)), false);
  assert.equal(
    (
      await app.inject({
        method: 'GET',
        url: `/api/orders/${aliceOrderId}`,
        headers: { cookie: bobCookie },
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: 'GET',
        url: `/api/orders/${aliceOrderId}`,
        headers: { cookie: adminCookie },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/orders', headers: { cookie: adminCookie } }))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: `/api/orders/${aliceOrderId}/cancel`,
        headers: { cookie: bobCookie },
        payload: { version: 0, idempotencyKey: 'dbd1d7a0-1735-49cc-9962-df4abcb758a0' },
      })
    ).statusCode,
    404,
  );

  const malformed = await app.inject({
    method: 'POST',
    url: `/api/admin/orders/${lifecycleOrderId}/shipments`,
    headers: { cookie: adminCookie },
    payload: { version: 0, idempotencyKey: 'invalid' },
  });
  assert.equal(malformed.statusCode, 400);
  const lineId = repository.findDetailById(lifecycleOrderId)?.items[0]?.lineId;
  if (!lineId) throw new Error('Expected line ID');
  const packPayload = {
    version: 0,
    idempotencyKey: '021ae3a0-354e-44be-8ae0-263c3e835bcf',
    shipments: [{ lines: [{ lineId, quantity: 1 }] }],
  };
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: `/api/admin/orders/${lifecycleOrderId}/shipments`,
        payload: packPayload,
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: `/api/admin/orders/${lifecycleOrderId}/shipments`,
        headers: { cookie: aliceCookie },
        payload: packPayload,
      })
    ).statusCode,
    403,
  );
  const packed = await app.inject({
    method: 'POST',
    url: `/api/admin/orders/${lifecycleOrderId}/shipments`,
    headers: { cookie: adminCookie },
    payload: packPayload,
  });
  assert.equal(packed.statusCode, 200);
  const packedBody = packed.json<{ shipments: Array<{ id: string }> }>();
  const shipmentId = packedBody.shipments[0]!.id;
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: `/api/orders/${aliceOrderId}/cancel`,
        headers: { cookie: aliceCookie },
        payload: { version: 0, idempotencyKey: '0902bf32-fa5c-4b56-868a-41ea54834c06' },
      })
    ).statusCode,
    200,
  );
  const shipped = await app.inject({
    method: 'POST',
    url: `/api/admin/order-shipments/${shipmentId}/transition`,
    headers: { cookie: adminCookie },
    payload: {
      version: 0,
      status: 'shipped',
      idempotencyKey: '0cbb67b2-6fce-4985-8e7d-24949fa3ef2e',
    },
  });
  assert.equal(shipped.statusCode, 200);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: `/api/admin/order-shipments/${shipmentId}/tracking-events`,
        headers: { cookie: adminCookie },
        payload: {
          version: 1,
          code: 'in_transit',
          title: '<b>Unsafe</b>',
          idempotencyKey: '3c00a1f9-1f52-4bf0-bcff-558a9ab7a793',
        },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: `/api/admin/order-shipments/${shipmentId}/tracking-events`,
        headers: { cookie: adminCookie },
        payload: {
          version: 1,
          code: 'in_transit',
          title: 'In transit',
          idempotencyKey: '51d06e22-31a8-4ab4-8fd1-8a2b81579f18',
        },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: `/api/admin/order-shipments/${shipmentId}/transition`,
        headers: { cookie: adminCookie },
        payload: {
          version: 1,
          status: 'delivered',
          idempotencyKey: '4681e96e-34f1-4d3c-8e73-cce7d1182dd6',
        },
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await app.inject({
        method: 'GET',
        url: `/api/orders/${bobOrderId}`,
        headers: { cookie: aliceCookie },
      })
    ).statusCode,
    404,
  );
});

void test('guest payment grants an exact-order, expiring capability cookie', async (t) => {
  let now = new Date('2026-07-19T12:00:00.000Z');
  const { db, app } = await createSeededFixture({
    testContext: t,
    app: {
      clock: { now: () => now },
      orderAccessTokenSource: () => 'deterministic-guest-capability',
    },
  });

  const cart = await app.inject({ method: 'POST', url: '/api/cart' });
  const cartId = cart.json<{ cartId: string }>().cartId;
  // Resolve a valid variant ID first
  const vId = (
    db
      .prepare('SELECT id FROM product_variants WHERE active = 1 ORDER BY sort_order LIMIT 1')
      .get() as { id: number }
  ).id;
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: `/api/cart/${cartId}/items`,
        payload: { productId: '1', variantId: vId },
      })
    ).statusCode,
    200,
  );
  const payment = await app.inject({
    method: 'POST',
    url: '/api/payments/pay',
    payload: {
      cartId,
      customerName: 'Guest Buyer',
      customerEmail: 'guest@example.test',
      deliveryDestination: adhocDestination,
      billingSelection: adhocBilling,
      deliverySlot: bookableSlot(now),
      cardNumber: '4242 4242 4242 4242',
      cardExpiry: '12/99',
      cardCvc: '123',
      idempotencyKey: '0f895d1a-776d-4da2-a549-4ce96c0f108a',
    },
  });
  assert.equal(payment.statusCode, 201);
  const paymentBody = payment.json<{ id: string }>();
  const orderId = paymentBody.id;
  assert.equal(JSON.stringify(paymentBody).includes('deterministic-guest-capability'), false);
  const setCookie = Array.isArray(payment.headers['set-cookie'])
    ? payment.headers['set-cookie'][0]
    : payment.headers['set-cookie'];
  assert.match(setCookie ?? '', new RegExp(`qpc_order_${orderId}=`));
  assert.match(setCookie ?? '', /HttpOnly/i);
  assert.match(setCookie ?? '', /SameSite=Lax/i);
  assert.match(setCookie ?? '', /Max-Age=86400/i);
  assert.match(setCookie ?? '', new RegExp(`Path=/api/orders/${orderId}`));
  const capabilityCookie = cookieValue(payment);
  const replayConflict = await app.inject({
    method: 'POST',
    url: '/api/payments/pay',
    payload: {
      cartId,
      customerName: 'Changed Guest',
      customerEmail: 'guest@example.test',
      deliveryDestination: adhocDestination,
      billingSelection: adhocBilling,
      deliverySlot: bookableSlot(now),
      cardNumber: '4242 4242 4242 4242',
      cardExpiry: '12/99',
      cardCvc: '123',
      idempotencyKey: '0f895d1a-776d-4da2-a549-4ce96c0f108a',
    },
  });
  assert.equal(replayConflict.statusCode, 409);
  const persistedPayment = db
    .prepare('SELECT response_json FROM payments WHERE idempotency_key = ?')
    .get('0f895d1a-776d-4da2-a549-4ce96c0f108a') as { response_json: string };
  const persistedLifecycle = db
    .prepare(
      `SELECT title || COALESCE(detail, '') || COALESCE(location, '') AS content
    FROM order_lifecycle_events WHERE order_id = ?`,
    )
    .all(Number(orderId)) as Array<{ content: string }>;
  const persistedAudit = db
    .prepare('SELECT metadata_json FROM audit_events WHERE entity_id = ?')
    .all(orderId) as Array<{ metadata_json: string }>;
  assert.equal(persistedPayment.response_json.includes('deterministic-guest-capability'), false);
  assert.equal(
    persistedLifecycle.some((event) => event.content.includes('deterministic-guest-capability')),
    false,
  );
  assert.equal(
    persistedAudit.some((event) => event.metadata_json.includes('deterministic-guest-capability')),
    false,
  );
  assert.equal(
    (
      await app.inject({
        method: 'GET',
        url: `/api/orders/${orderId}`,
        headers: { cookie: capabilityCookie },
      })
    ).statusCode,
    200,
  );
  const unrelatedSessionCookie = await login(app, 'bob@example.com');
  assert.equal(
    (
      await app.inject({
        method: 'GET',
        url: `/api/orders/${orderId}`,
        headers: { cookie: `${unrelatedSessionCookie}; ${capabilityCookie}` },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        method: 'GET',
        url: `/api/orders/${Number(orderId) + 1}`,
        headers: { cookie: capabilityCookie },
      })
    ).statusCode,
    404,
  );
  now = new Date('2026-07-20T12:00:00.001Z');
  assert.equal(
    (
      await app.inject({
        method: 'GET',
        url: `/api/orders/${orderId}`,
        headers: { cookie: capabilityCookie },
      })
    ).statusCode,
    404,
  );
});
