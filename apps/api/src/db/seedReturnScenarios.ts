import { LEGACY_DATA_COUNTRY } from '@shop/contracts';
import type Database from 'better-sqlite3';

export const DEMO_RETURN_SCENARIO_KEYS = ['bob-delivered-returned'] as const;

type ReturnScenarioKey = (typeof DEMO_RETURN_SCENARIO_KEYS)[number];

type ReturnScenario = {
  key: ReturnScenarioKey;
  orderSeedKey: string;
  reason: string;
  note: string | null;
  items: Array<{ shipmentNumber: number; productIndex: number; quantity: number }>;
};

const SCENARIOS: readonly ReturnScenario[] = [
  {
    key: 'bob-delivered-returned',
    orderSeedKey: 'bob-delivered',
    reason: 'not_as_expected',
    note: null,
    items: [{ shipmentNumber: 1, productIndex: 0, quantity: 1 }],
  },
];

/**
 * Inserts immutable return/refund demo fixtures once. Existing fixture state is never rewritten.
 * Must be called after seedOrderScenarios so the FK targets exist.
 */
export function seedReturnScenarios(db: Database.Database): void {
  const findUser = db.prepare('SELECT id FROM users WHERE email = ? AND country = ?');
  const findOrder = db.prepare(
    'SELECT id, subtotal_cents, discount_cents, total_cents FROM orders WHERE demo_seed_key = ?',
  );
  const findShipment = db.prepare(
    'SELECT id FROM order_shipments WHERE order_id = ? AND shipment_number = ?',
  );
  const findLineItem = db.prepare(
    'SELECT id FROM order_line_items WHERE order_id = ? AND product_id = ? LIMIT 1',
  );
  const findPayment = db.prepare(
    "SELECT id FROM payments WHERE order_id = ? AND status = 'succeeded' LIMIT 1",
  );
  const findDeliveryEvent = db.prepare(
    "SELECT occurred_at FROM order_lifecycle_events WHERE shipment_id = ? AND event_type = 'shipment_delivered' ORDER BY occurred_at DESC LIMIT 1",
  );

  const insertRequest = db.prepare(`
    INSERT OR IGNORE INTO return_requests
      (order_id, user_id, status, reason, note, version, requested_at, approved_at, received_at, refunded_at)
    VALUES (?, ?, 'refunded', ?, ?, 4, ?, ?, ?, ?)
  `);
  const findRequest = db.prepare(
    "SELECT id FROM return_requests WHERE order_id = ? AND reason = ? AND status = 'refunded'",
  );

  const insertItem = db.prepare(`
    INSERT OR IGNORE INTO return_request_items
      (return_request_id, shipment_id, order_line_item_id, quantity, product_name, delivered_at, window_closes_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertEvent = db.prepare(`
    INSERT OR IGNORE INTO return_events
      (return_request_id, order_id, event_type, actor_user_id, idempotency_key, request_fingerprint, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertRefund = db.prepare(`
    INSERT OR IGNORE INTO refunds
      (return_request_id, payment_id, idempotency_key, gross_subtotal_cents, discount_share_cents, net_refund_cents, processor, simulated_reference, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'simulated', ?, ?)
  `);
  const findRefund = db.prepare('SELECT id FROM refunds WHERE return_request_id = ?');

  const insertRefundItem = db.prepare(`
    INSERT OR IGNORE INTO refund_items
      (refund_id, return_request_item_id, quantity, gross_subtotal_cents, discount_share_cents, net_refund_cents)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const bob = findUser.get('bob@example.com', LEGACY_DATA_COUNTRY) as { id: number } | undefined;
  if (!bob) return;

  for (const scenario of SCENARIOS) {
    const order = findOrder.get(scenario.orderSeedKey) as
      | { id: number; subtotal_cents: number; discount_cents: number; total_cents: number }
      | undefined;
    if (!order) continue;

    const payment = findPayment.get(order.id) as { id: number } | undefined;
    if (!payment) continue;

    // Resolve items
    const itemRows: Array<{
      shipmentId: number;
      lineItemId: number;
      quantity: number;
      productName: string;
      deliveredAt: string;
    }> = [];
    for (const item of scenario.items) {
      const shipment = findShipment.get(order.id, item.shipmentNumber) as
        { id: number } | undefined;
      if (!shipment) continue;
      const lineItem = findLineItem.get(order.id, 1) as { id: number } | undefined; // product 1 = Protein Powder
      if (!lineItem) continue;
      const deliveryEvent = findDeliveryEvent.get(shipment.id) as
        { occurred_at: string } | undefined;
      if (!deliveryEvent) continue;
      itemRows.push({
        shipmentId: shipment.id,
        lineItemId: lineItem.id,
        quantity: item.quantity,
        productName: 'Protein Powder',
        deliveredAt: deliveryEvent.occurred_at,
      });
    }
    if (itemRows.length === 0) continue;

    const deliveryDate = new Date(itemRows[0]!.deliveredAt);
    const windowClose = new Date(deliveryDate.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Insert return request (requested_at uses delivery date + 1 day)
    const requestedAt = new Date(deliveryDate.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const approvedAt = new Date(deliveryDate.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString();
    const receivedAt = new Date(deliveryDate.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const refundedAt = new Date(deliveryDate.getTime() + 4 * 24 * 60 * 60 * 1000).toISOString();

    insertRequest.run(
      order.id,
      bob.id,
      scenario.reason,
      scenario.note,
      requestedAt,
      approvedAt,
      receivedAt,
      refundedAt,
    );

    const request = findRequest.get(order.id, scenario.reason) as { id: number } | undefined;
    if (!request) continue;

    // Insert items
    for (const row of itemRows) {
      insertItem.run(
        request.id,
        row.shipmentId,
        row.lineItemId,
        row.quantity,
        row.productName,
        row.deliveredAt,
        windowClose.toISOString(),
      );
    }

    // Insert events
    const seedFingerprint = `seed-${scenario.key}`;
    insertEvent.run(
      request.id,
      order.id,
      'return.requested',
      bob.id,
      `seed-return-requested-${scenario.key}`,
      `${seedFingerprint}-requested`,
      requestedAt,
    );
    insertEvent.run(
      request.id,
      order.id,
      'return.approved',
      bob.id,
      `seed-return-approved-${scenario.key}`,
      `${seedFingerprint}-approved`,
      approvedAt,
    );
    insertEvent.run(
      request.id,
      order.id,
      'return.received',
      bob.id,
      `seed-return-received-${scenario.key}`,
      `${seedFingerprint}-received`,
      receivedAt,
    );
    insertEvent.run(
      request.id,
      order.id,
      'payment.refunded',
      bob.id,
      `seed-payment-refunded-${scenario.key}`,
      `${seedFingerprint}-refunded`,
      refundedAt,
    );

    // Insert refund (full line total = product price cents * quantity)
    const refundAmount = order.subtotal_cents; // full refund since discount = 0 and 1 item
    insertRefund.run(
      request.id,
      payment.id,
      `seed-refund-${scenario.key}`,
      refundAmount,
      0,
      refundAmount,
      `sim_refund_seed_${scenario.key}`,
      refundedAt,
    );

    const refund = findRefund.get(request.id) as { id: number } | undefined;
    if (!refund) continue;

    // Insert refund items
    const returnItems = db
      .prepare('SELECT id, quantity FROM return_request_items WHERE return_request_id = ?')
      .all(request.id) as Array<{ id: number; quantity: number }>;
    for (const ri of returnItems) {
      insertRefundItem.run(refund.id, ri.id, ri.quantity, refundAmount, 0, refundAmount);
    }

    // Note: inventory_stock_movements for return_received are not seed-inserted
    // because inventory tests rely on deterministic movement counts.
  }
}
