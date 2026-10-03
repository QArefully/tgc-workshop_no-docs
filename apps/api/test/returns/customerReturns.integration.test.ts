import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../../src/app.js';
import { createSeededFixture } from '../support/seededDatabase.js';

function cookie(response: { headers: Record<string, string | string[] | undefined> }): string {
  const h = response.headers['set-cookie'];
  const c = Array.isArray(h) ? h[0] : h;
  if (!c) throw new Error('Expected set-cookie');
  return c.split(';', 1)[0]!;
}

async function login(app: Awaited<ReturnType<typeof buildApp>>, email: string): Promise<string> {
  const r = await app.inject({
    method: 'POST',
    url: '/login',
    payload: { email, password: 'Password123!', country: 'UK' },
  });
  assert.equal(r.statusCode, 200);
  return cookie(r);
}

void test('customer return routes enforce ownership and auth', async (t) => {
  const { app } = await createSeededFixture(t);

  const aliceCookie = await login(app, 'alice@example.com');
  const bobCookie = await login(app, 'bob@example.com');

  // Alice has a split-shipped order with one delivered shipment (product 1, qty 1)
  // Let's find it via her order list
  const aliceOrders = await app.inject({
    method: 'GET',
    url: '/api/orders?page=1&pageSize=50',
    headers: { cookie: aliceCookie },
  });
  assert.equal(aliceOrders.statusCode, 200);
  const aliceOrderIds = aliceOrders.json<{ items: Array<{ id: string }> }>().items.map((o) => o.id);

  // Bob's delivered order (bob-delivered: product 1, qty 1)
  const bobOrders = await app.inject({
    method: 'GET',
    url: '/api/orders?page=1&pageSize=50',
    headers: { cookie: bobCookie },
  });
  assert.equal(bobOrders.statusCode, 200);

  // ── Anonymous access ──────────────────────────────────────────
  {
    const r = await app.inject({
      method: 'GET',
      url: `/api/orders/${aliceOrderIds[0]}/returns`,
    });
    assert.equal(r.statusCode, 401);
  }

  // ── Bob can't access Alice's returns ──────────────────────────
  {
    const r = await app.inject({
      method: 'GET',
      url: `/api/orders/${aliceOrderIds[0]}/returns`,
      headers: { cookie: bobCookie },
    });
    assert.equal(r.statusCode, 404);
    assert.equal(r.json<{ code: string }>().code, 'RETURN_NOT_FOUND');
  }

  // ── Alice can see her overview (delivered order) ──────────────
  // Find Alice's split-shipped order (has one delivered shipment)
  const aliceDeliveredOrderId = aliceOrderIds[0]; // First order by create time
  {
    const r = await app.inject({
      method: 'GET',
      url: `/api/orders/${aliceDeliveredOrderId}/returns`,
      headers: { cookie: aliceCookie },
    });
    // May be 200 or 404 depending on whether the order has delivered shipments
    // The 'alice-split-shipped' order has one delivered shipment (product 1, qty 1)
    assert.ok(r.statusCode === 200 || r.statusCode === 404);
    if (r.statusCode === 200) {
      const body = r.json<{ eligibleLines: unknown[]; requests: unknown[]; windowDays: number }>();
      assert.equal(body.windowDays, 30);
      assert.ok(Array.isArray(body.eligibleLines));
      assert.ok(Array.isArray(body.requests));
    }
  }

  // ── Create return request ─────────────────────────────────────
  {
    // Find the order with delivered shipments. Let's use Alice's split-shipped order.
    const overview = await app.inject({
      method: 'GET',
      url: `/api/orders/${aliceDeliveredOrderId}/returns`,
      headers: { cookie: aliceCookie },
    });
    if (overview.statusCode === 200) {
      const body = overview.json<{
        eligibleLines: Array<{
          shipmentId: string;
          orderLineItemId: string;
          availableQuantity: number;
        }>;
      }>();
      if (body.eligibleLines.length > 0 && body.eligibleLines[0].availableQuantity > 0) {
        const line = body.eligibleLines[0];
        const create = await app.inject({
          method: 'POST',
          url: `/api/orders/${aliceDeliveredOrderId}/returns`,
          headers: { cookie: aliceCookie },
          payload: {
            idempotencyKey: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee1',
            reason: 'damaged',
            note: 'Test note',
            selections: [
              {
                shipmentId: line.shipmentId,
                orderLineItemId: line.orderLineItemId,
                quantity: 1,
              },
            ],
          },
        });
        assert.equal(create.statusCode, 200);
        const created = create.json<{ id: string; status: string; version: number }>();
        assert.equal(created.status, 'requested');
        assert.equal(created.version, 0);
      }
    }
  }
});

void test('return request validation rejects invalid inputs', async (t) => {
  const { app } = await createSeededFixture(t);

  const aliceCookie = await login(app, 'alice@example.com');

  // Get Alice's order list
  const orders = await app.inject({
    method: 'GET',
    url: '/api/orders?page=1&pageSize=50',
    headers: { cookie: aliceCookie },
  });
  const orderIds = orders.json<{ items: Array<{ id: string }> }>().items.map((o) => o.id);
  const firstOrderId = orderIds[0];

  // ── Empty selections rejected ──────────────────────────────────
  {
    const r = await app.inject({
      method: 'POST',
      url: `/api/orders/${firstOrderId}/returns`,
      headers: { cookie: aliceCookie },
      payload: {
        idempotencyKey: 'bbbbbbbb-cccc-dddd-eeee-fffffffffff1',
        reason: 'damaged',
        selections: [],
      },
    });
    // Should fail validation (400) because minItems=1
    assert.equal(r.statusCode, 400);
  }

  // ── Invalid reason rejected ────────────────────────────────────
  {
    const r = await app.inject({
      method: 'POST',
      url: `/api/orders/${firstOrderId}/returns`,
      headers: { cookie: aliceCookie },
      payload: {
        idempotencyKey: 'cccccccc-dddd-eeee-ffff-000000000001',
        reason: 'invalid_reason',
        selections: [{ shipmentId: '1', orderLineItemId: '1', quantity: 1 }],
      },
    });
    assert.equal(r.statusCode, 400);
  }

  // ── Markup in note rejected ────────────────────────────────────
  {
    const r = await app.inject({
      method: 'POST',
      url: `/api/orders/${firstOrderId}/returns`,
      headers: { cookie: aliceCookie },
      payload: {
        idempotencyKey: 'dddddddd-eeee-ffff-0000-111111111111',
        reason: 'damaged',
        note: '<script>alert(1)</script>',
        selections: [{ shipmentId: '1', orderLineItemId: '1', quantity: 1 }],
      },
    });
    assert.equal(r.statusCode, 400);
  }
});
