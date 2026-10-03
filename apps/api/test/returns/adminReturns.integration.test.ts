import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../../src/app.js';
import { createUnitOfWork } from '../../src/db/unitOfWork.js';
import { createAuditRepository } from '../../src/features/audit/auditRepository.js';
import { createAuditWriter } from '../../src/features/audit/auditService.js';
import { createAdminRefundService } from '../../src/features/payments/adminRefundService.js';
import { createReturnRepository } from '../../src/features/returns/returnRepository.js';
import { createRefundGateway } from '../../src/features/returns/refundGateway.js';
import { createSeededFixture } from '../support/seededDatabase.js';

function insertCreditOrder(
  db: Parameters<typeof createReturnRepository>[0],
  userId: number,
): { orderId: number; paymentId: number; companyId: number } {
  const now = '2026-09-03T10:00:00.000Z';
  const companyId = Number(
    db
      .prepare(
        `INSERT INTO company_accounts
           (name, created_by_user_id, active, approval_threshold_cents, credit_limit_cents,
            credit_terms_days, credit_state, credit_version, created_at, updated_at)
         VALUES ('Returns Credit Ltd', ?, 1, NULL, 100000, 30, 'active', 0, ?, ?)`,
      )
      .run(userId, now, now).lastInsertRowid,
  );
  const orderId = Number(
    db
      .prepare(
        `INSERT INTO orders
           (customer_name, customer_email, shipping_address, subtotal_cents, discount_cents,
            total_cents, user_id, created_at, lifecycle_status, version,
            payment_method, company_id, net_cents, vat_rate_basis_points, vat_cents, gross_cents)
         VALUES ('Credit Buyer', 'alice@example.com', 'Credit address', 1000, 0,
                 1200, ?, ?, 'delivered', 0, 'trade_credit', ?, 1000, 2000, 200, 1200)`,
      )
      .run(userId, now, companyId).lastInsertRowid,
  );
  const paymentId = Number(
    db
      .prepare(
        `INSERT INTO payments
           (order_id, idempotency_key, request_fingerprint, status, amount_cents, created_at,
            payment_method, company_id, user_id)
         VALUES (?, 'credit-return-payment', 'credit-return-fingerprint', 'succeeded', 1200, ?,
                 'trade_credit', ?, ?)`,
      )
      .run(orderId, now, companyId, userId).lastInsertRowid,
  );
  return { orderId, paymentId, companyId };
}

function setSettlementMethods(
  db: Parameters<typeof createReturnRepository>[0],
  orderId: number,
  paymentId: number,
  orderMethod: string,
  paymentMethod: string,
): void {
  // Deliberately bypass CHECK constraints to exercise the return boundary's corruption path.
  db.pragma('ignore_check_constraints = ON');
  try {
    db.prepare('UPDATE orders SET payment_method = ? WHERE id = ?').run(orderMethod, orderId);
    db.prepare('UPDATE payments SET payment_method = ? WHERE id = ?').run(paymentMethod, paymentId);
  } finally {
    db.pragma('ignore_check_constraints = OFF');
  }
}

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

/** Find Alice's order that has delivered shipments and create a return request for it. */
async function createReturnForAlice(
  app: Awaited<ReturnType<typeof buildApp>>,
  aliceCookie: string,
): Promise<{ orderId: string; returnId: string } | null> {
  const orders = await app.inject({
    method: 'GET',
    url: '/api/orders?page=1&pageSize=50',
    headers: { cookie: aliceCookie },
  });
  const orderIds = orders.json<{ items: Array<{ id: string }> }>().items.map((o) => o.id);

  for (const orderId of orderIds) {
    const overview = await app.inject({
      method: 'GET',
      url: `/api/orders/${orderId}/returns`,
      headers: { cookie: aliceCookie },
    });
    if (overview.statusCode !== 200) continue;
    const body = overview.json<{
      eligibleLines: Array<{
        shipmentId: string;
        orderLineItemId: string;
        availableQuantity: number;
      }>;
    }>();
    if (body.eligibleLines.length === 0) continue;
    const line = body.eligibleLines.find((l) => l.availableQuantity > 0);
    if (!line) continue;

    const create = await app.inject({
      method: 'POST',
      url: `/api/orders/${orderId}/returns`,
      headers: { cookie: aliceCookie },
      payload: {
        idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        reason: 'damaged',
        selections: [
          {
            shipmentId: line.shipmentId,
            orderLineItemId: line.orderLineItemId,
            quantity: line.availableQuantity,
          },
        ],
      },
    });
    if (create.statusCode === 200) {
      return {
        orderId,
        returnId: create.json<{ id: string }>().id,
      };
    }
  }
  return null;
}

void test('admin return routes enforce auth and process lifecycle', async (t) => {
  const { db, app } = await createSeededFixture(t);

  const aliceCookie = await login(app, 'alice@example.com');
  const adminCookie = await login(app, 'admin@example.com');

  // ── Customer cannot access admin routes ──────────────────────
  {
    const r = await app.inject({
      method: 'GET',
      url: '/api/admin/returns',
      headers: { cookie: aliceCookie },
    });
    assert.equal(r.statusCode, 403);
  }

  // ── Anonymous cannot access admin routes ─────────────────────
  {
    const r = await app.inject({
      method: 'GET',
      url: '/api/admin/returns',
    });
    assert.equal(r.statusCode, 401);
  }

  // ── Admin can list returns ────────────────────────────────────
  {
    const r = await app.inject({
      method: 'GET',
      url: '/api/admin/returns',
      headers: { cookie: adminCookie },
    });
    assert.equal(r.statusCode, 200);
    const body = r.json<{ items: unknown[]; page: number; pageSize: number }>();
    assert.equal(body.page, 1);
    assert.ok(Array.isArray(body.items));
  }

  // ── Create a return request for testing ───────────────────────
  const setup = await createReturnForAlice(app, aliceCookie);
  if (!setup) {
    // Skip lifecycle tests if no eligible order exists in seed
    return;
  }

  const returnId = setup.returnId;

  // ── Inspect the created return ─────────────────────────────────
  const detail = await app.inject({
    method: 'GET',
    url: `/api/admin/returns?page=1&pageSize=50`,
    headers: { cookie: adminCookie },
  });
  const listBody = detail.json<{
    items: Array<{ id: string; status: string; version: number; orderId: string }>;
  }>();
  const found = listBody.items.find((item) => item.id === returnId);
  assert.ok(found, 'Created return should appear in admin list');
  assert.equal(found.status, 'requested');

  // ── Admin approve ─────────────────────────────────────────────
  {
    const r = await app.inject({
      method: 'POST',
      url: `/api/admin/returns/${returnId}/decision`,
      headers: { cookie: adminCookie },
      payload: {
        version: found.version,
        idempotencyKey: 'admin-approve-0001-0001-0001-00000000001',
        decision: 'approve',
      },
    });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json<{ status: string }>().status, 'approved');
  }

  // ── Admin receive ─────────────────────────────────────────────
  {
    const r = await app.inject({
      method: 'POST',
      url: `/api/admin/returns/${returnId}/receive`,
      headers: { cookie: adminCookie },
      payload: {
        version: 1,
        idempotencyKey: 'admin-receive-0001-0001-0001-00000000001',
      },
    });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json<{ status: string }>().status, 'received');
  }

  // ── Admin refund (may fail if no succeeded payment) ───────────
  {
    const payment = db
      .prepare(
        "SELECT id, amount_cents FROM payments WHERE order_id = ? AND status = 'succeeded' ORDER BY id LIMIT 1",
      )
      .get(Number(setup.orderId)) as { id: number; amount_cents: number } | undefined;
    assert.ok(payment, 'Return order should have a captured payment');
    if (!payment) throw new Error('Expected captured payment');

    const adminRefunds = createAdminRefundService({
      db,
      unitOfWork: createUnitOfWork(db),
      audit: createAuditWriter({
        repository: createAuditRepository(db),
        clock: { now: () => new Date('2026-07-29T10:00:00.000Z') },
      }),
      clock: { now: () => new Date('2026-07-29T10:00:00.000Z') },
      refundGateway: createRefundGateway(),
    });
    adminRefunds.refund({
      paymentId: payment.id,
      orderId: Number(setup.orderId),
      amountCents: payment.amount_cents,
      reason: 'Commercial goodwill',
      idempotencyKey: 'admin-payment-cap-0001-0001-0001-00000000001',
      context: { actor: { type: 'user', userId: 1 }, requestId: 'admin-payment-cap' },
    });

    const r = await app.inject({
      method: 'POST',
      url: `/api/admin/returns/${returnId}/refund`,
      headers: { cookie: adminCookie },
      payload: {
        version: 2,
        idempotencyKey: 'admin-refund-0001-0001-0001-00000000001',
      },
    });
    assert.equal(r.statusCode, 422);
    assert.equal(
      (
        db
          .prepare('SELECT COUNT(*) AS count FROM refunds WHERE payment_id = ?')
          .get(payment.id) as {
          count: number;
        }
      ).count,
      0,
    );
    assert.equal(
      (
        db
          .prepare(
            `SELECT
               COALESCE((SELECT SUM(net_refund_cents) FROM refunds WHERE payment_id = ?), 0) +
               COALESCE((SELECT SUM(amount_cents) FROM admin_refunds WHERE payment_id = ?), 0)
               AS amount`,
          )
          .get(payment.id, payment.id) as { amount: number }
      ).amount,
      payment.amount_cents,
    );
    assert.equal(
      (
        db.prepare('SELECT status FROM return_requests WHERE id = ?').get(Number(returnId)) as {
          status: string;
        }
      ).status,
      'received',
    );
    assert.equal(
      (
        db
          .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'payment.refunded'")
          .get() as { count: number }
      ).count,
      0,
    );
    assert.equal(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'payment.admin_refunded'",
          )
          .get() as { count: number }
      ).count,
      1,
    );
  }

  // ── Stale version rejected ────────────────────────────────────
  {
    const r = await app.inject({
      method: 'POST',
      url: `/api/admin/returns/${returnId}/decision`,
      headers: { cookie: adminCookie },
      payload: {
        version: 0, // stale
        idempotencyKey: 'admin-stale-0001-0001-0001-00000000001',
        decision: 'approve',
      },
    });
    assert.equal(r.statusCode, 409);
  }

  // ── Idempotency replay ────────────────────────────────────────
  {
    // Replay the approve with same key + payload -> should get current resource
    const r = await app.inject({
      method: 'POST',
      url: `/api/admin/returns/${returnId}/decision`,
      headers: { cookie: adminCookie },
      payload: {
        version: found.version,
        idempotencyKey: 'admin-approve-0001-0001-0001-00000000001', // same key
        decision: 'approve',
      },
    });
    assert.equal(r.statusCode, 200);
  }

  // ── Idempotency conflict ──────────────────────────────────────
  {
    // Same key, different payload -> conflict
    const r = await app.inject({
      method: 'POST',
      url: `/api/admin/returns/${returnId}/decision`,
      headers: { cookie: adminCookie },
      payload: {
        version: found.version,
        idempotencyKey: 'admin-approve-0001-0001-0001-00000000001', // same key
        decision: 'reject', // different payload
      },
    });
    assert.equal(r.statusCode, 409);
  }

  // ── Invalid transition rejected ───────────────────────────────
  {
    // Try to receive a non-approved return -> should fail
    const r = await app.inject({
      method: 'POST',
      url: `/api/admin/returns/${returnId}/receive`,
      headers: { cookie: adminCookie },
      payload: {
        version: 100, // whatever
        idempotencyKey: 'admin-bad-trans-0001-0001-00000000001',
      },
    });
    assert.ok(r.statusCode === 404 || r.statusCode === 409);
  }

  // ── Filter by status ──────────────────────────────────────────
  {
    const r = await app.inject({
      method: 'GET',
      url: '/api/admin/returns?status=requested',
      headers: { cookie: adminCookie },
    });
    assert.equal(r.statusCode, 200);
  }
});

void test('trade-credit returns fail before creating rows, restoring stock, or refunding', async (t) => {
  const { db, app } = await createSeededFixture(t);
  const alice = db
    .prepare('SELECT id FROM users WHERE email = ? AND country = ? LIMIT 1')
    .get('alice@example.com', 'UK') as { id: number } | undefined;
  assert.ok(alice);
  if (!alice) throw new Error('Expected seeded Alice');
  const { orderId, paymentId } = insertCreditOrder(db, alice.id);
  const aliceCookie = await login(app, 'alice@example.com');
  const adminCookie = await login(app, 'admin@example.com');

  const returnsBefore = (
    db.prepare('SELECT COUNT(*) AS count FROM return_requests').get() as { count: number }
  ).count;

  const overview = await app.inject({
    method: 'GET',
    url: `/api/orders/${orderId}/returns`,
    headers: { cookie: aliceCookie },
  });
  assert.equal(overview.statusCode, 409, overview.body);
  assert.equal(overview.json<{ code: string }>().code, 'PAYMENT_NOT_REFUNDABLE');

  const request = await app.inject({
    method: 'POST',
    url: `/api/orders/${orderId}/returns`,
    headers: { cookie: aliceCookie },
    payload: {
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
      reason: 'damaged',
      selections: [{ shipmentId: '1', orderLineItemId: '1', quantity: 1 }],
    },
  });
  assert.equal(request.statusCode, 409);
  assert.equal(request.json<{ code: string }>().code, 'PAYMENT_NOT_REFUNDABLE');
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM return_requests').get() as { count: number }).count,
    returnsBefore,
  );

  const approvedReturnId = Number(
    db
      .prepare(
        `INSERT INTO return_requests
           (order_id, user_id, status, reason, version, requested_at, approved_at)
         VALUES (?, ?, 'approved', 'other', 0, ?, ?)`,
      )
      .run(orderId, alice.id, '2026-09-03T10:00:00.000Z', '2026-09-03T10:01:00.000Z')
      .lastInsertRowid,
  );
  const receive = await app.inject({
    method: 'POST',
    url: `/api/admin/returns/${approvedReturnId}/receive`,
    headers: { cookie: adminCookie },
    payload: {
      version: 0,
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
    },
  });
  assert.equal(receive.statusCode, 409);
  assert.equal(receive.json<{ code: string }>().code, 'PAYMENT_NOT_REFUNDABLE');
  assert.deepEqual(
    db.prepare('SELECT status, version FROM return_requests WHERE id = ?').get(approvedReturnId),
    { status: 'approved', version: 0 },
  );
  assert.equal(
    (
      db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM inventory_stock_movements
           WHERE return_request_id = ? AND movement_type = 'return_received'`,
        )
        .get(approvedReturnId) as { count: number }
    ).count,
    0,
  );

  const receivedReturnId = Number(
    db
      .prepare(
        `INSERT INTO return_requests
           (order_id, user_id, status, reason, version, requested_at, approved_at, received_at)
         VALUES (?, ?, 'received', 'other', 2, ?, ?, ?)`,
      )
      .run(
        orderId,
        alice.id,
        '2026-09-03T10:00:00.000Z',
        '2026-09-03T10:01:00.000Z',
        '2026-09-03T10:02:00.000Z',
      ).lastInsertRowid,
  );
  const refund = await app.inject({
    method: 'POST',
    url: `/api/admin/returns/${receivedReturnId}/refund`,
    headers: { cookie: adminCookie },
    payload: {
      version: 2,
      idempotencyKey: '33333333-3333-4333-8333-333333333333',
    },
  });
  assert.equal(refund.statusCode, 409);
  assert.equal(refund.json<{ code: string }>().code, 'PAYMENT_NOT_REFUNDABLE');
  assert.equal(
    (
      db.prepare('SELECT COUNT(*) AS count FROM refunds WHERE payment_id = ?').get(paymentId) as {
        count: number;
      }
    ).count,
    0,
  );

  const returnRepository = createReturnRepository(db);
  assert.equal(returnRepository.resolveSucceededPayment(orderId), undefined);
  assert.equal(returnRepository.getPaymentRefundedCents(paymentId), 0);
});

void test('return replays recheck ownership and the persisted card settlement', async (t) => {
  const { db, app } = await createSeededFixture({
    testContext: t,
    app: { clock: { now: () => new Date('2026-07-29T10:00:00.000Z') } },
  });
  const aliceCookie = await login(app, 'alice@example.com');
  const adminCookie = await login(app, 'admin@example.com');
  const setup = await createReturnForAlice(app, aliceCookie);
  assert.ok(setup, 'Expected a seeded delivered card order');
  if (!setup) return;

  const orderId = Number(setup.orderId);
  const returnId = Number(setup.returnId);
  const payment = db
    .prepare('SELECT id FROM payments WHERE order_id = ? ORDER BY id ASC LIMIT 1')
    .get(orderId) as { id: number } | undefined;
  assert.ok(payment, 'Expected a linked payment');
  if (!payment) return;

  const selection = db
    .prepare(
      `SELECT shipment_id AS shipmentId, order_line_item_id AS orderLineItemId, quantity
       FROM return_request_items WHERE return_request_id = ? LIMIT 1`,
    )
    .get(returnId) as { shipmentId: number; orderLineItemId: number; quantity: number } | undefined;
  assert.ok(selection, 'Expected a persisted return selection');
  if (!selection) return;

  const requestPayload = {
    idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    reason: 'damaged',
    selections: [
      {
        shipmentId: String(selection.shipmentId),
        orderLineItemId: String(selection.orderLineItemId),
        quantity: selection.quantity,
      },
    ],
  };

  // Customer request replay cannot bypass an order/payment method mismatch.
  setSettlementMethods(db, orderId, payment.id, 'trade_credit', 'card');
  const requestReplay = await app.inject({
    method: 'POST',
    url: `/api/orders/${orderId}/returns`,
    headers: { cookie: aliceCookie },
    payload: requestPayload,
  });
  assert.equal(requestReplay.statusCode, 409);
  assert.equal(requestReplay.json<{ code: string }>().code, 'PAYMENT_NOT_REFUNDABLE');
  setSettlementMethods(db, orderId, payment.id, 'card', 'card');

  // A different owner cannot reuse the request event either.
  const bobCookie = await login(app, 'bob@example.com');
  const ownerReplay = await app.inject({
    method: 'POST',
    url: `/api/orders/${orderId}/returns`,
    headers: { cookie: bobCookie },
    payload: requestPayload,
  });
  assert.equal(ownerReplay.statusCode, 404);

  const decisionPayload = {
    version: 0,
    idempotencyKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    decision: 'approve',
  } as const;
  const approved = await app.inject({
    method: 'POST',
    url: `/api/admin/returns/${returnId}/decision`,
    headers: { cookie: adminCookie },
    payload: decisionPayload,
  });
  assert.equal(approved.statusCode, 200, approved.body);

  // Lifecycle replay rejects an order/payment mismatch before returning the old event.
  setSettlementMethods(db, orderId, payment.id, 'card', 'trade_credit');
  const decisionReplay = await app.inject({
    method: 'POST',
    url: `/api/admin/returns/${returnId}/decision`,
    headers: { cookie: adminCookie },
    payload: decisionPayload,
  });
  assert.equal(decisionReplay.statusCode, 409);
  assert.equal(decisionReplay.json<{ code: string }>().code, 'PAYMENT_NOT_REFUNDABLE');
  setSettlementMethods(db, orderId, payment.id, 'card', 'card');

  const receivePayload = {
    version: 1,
    idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  };
  const received = await app.inject({
    method: 'POST',
    url: `/api/admin/returns/${returnId}/receive`,
    headers: { cookie: adminCookie },
    payload: receivePayload,
  });
  assert.equal(received.statusCode, 200, received.body);

  setSettlementMethods(db, orderId, payment.id, 'mystery', 'card');
  const receiveReplay = await app.inject({
    method: 'POST',
    url: `/api/admin/returns/${returnId}/receive`,
    headers: { cookie: adminCookie },
    payload: receivePayload,
  });
  assert.equal(receiveReplay.statusCode, 409);
  assert.equal(receiveReplay.json<{ code: string }>().code, 'PAYMENT_NOT_REFUNDABLE');
  setSettlementMethods(db, orderId, payment.id, 'card', 'card');

  const refundPayload = {
    version: 2,
    idempotencyKey: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  };
  const refunded = await app.inject({
    method: 'POST',
    url: `/api/admin/returns/${returnId}/refund`,
    headers: { cookie: adminCookie },
    payload: refundPayload,
  });
  assert.equal(refunded.statusCode, 200, refunded.body);

  setSettlementMethods(db, orderId, payment.id, 'card', 'mystery');
  const refundReplay = await app.inject({
    method: 'POST',
    url: `/api/admin/returns/${returnId}/refund`,
    headers: { cookie: adminCookie },
    payload: refundPayload,
  });
  assert.equal(refundReplay.statusCode, 409);
  assert.equal(refundReplay.json<{ code: string }>().code, 'PAYMENT_NOT_REFUNDABLE');
  setSettlementMethods(db, orderId, payment.id, 'card', 'card');
});
