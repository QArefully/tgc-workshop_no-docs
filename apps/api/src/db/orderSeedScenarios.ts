import { CATALOG_PRODUCTS } from '@shop/catalog';
import { LEGACY_DATA_COUNTRY } from '@shop/contracts';
import type Database from 'better-sqlite3';

export const DEMO_ORDER_SCENARIO_KEYS = [
  'alice-processing',
  'alice-packed',
  'alice-split-shipped',
  'alice-delivery-failed',
  'bob-delivered',
  'alice-reorder-mix',
] as const;

type ScenarioKey = (typeof DEMO_ORDER_SCENARIO_KEYS)[number];
type ProductLine = { productId: number; quantity: number };
/** Allocation of one product line (by index into `productLines`) to one shipment. */
type ShipmentLine = { index: number; quantity: number };
type ScenarioEvent = {
  type:
    | 'order_created'
    | 'shipment_packed'
    | 'shipment_shipped'
    | 'shipment_delivered'
    | 'shipment_delivery_failed'
    | 'shipment_tracking_updated';
  title: string;
  occurredAt: string;
  shipmentNumber?: number;
  code?: 'in_transit' | 'out_for_delivery' | 'delivery_attempted' | 'delivered';
  detail?: string;
  location?: string;
};
type Scenario = {
  key: ScenarioKey;
  userEmail: string;
  createdAt: string;
  status: 'processing' | 'packed' | 'shipped' | 'delivered' | 'delivery_failed';
  version: number;
  productLines: ProductLine[];
  shipments?: Array<{
    status: 'packed' | 'shipped' | 'delivered' | 'delivery_failed';
    trackingReference: string;
    createdAt: string;
    updatedAt: string;
    version: number;
    lines: ShipmentLine[];
  }>;
  events: ScenarioEvent[];
};

const SCENARIOS: readonly Scenario[] = [
  {
    key: 'alice-packed',
    userEmail: 'alice@example.com',
    createdAt: '2026-07-14T15:00:00.000Z',
    status: 'packed',
    version: 1,
    productLines: [{ productId: 27, quantity: 1 }],
    shipments: [
      {
        status: 'packed',
        trackingReference: 'QA-ALICE-PACKED-01',
        createdAt: '2026-07-14T16:00:00.000Z',
        updatedAt: '2026-07-14T16:00:00.000Z',
        version: 0,
        lines: [{ index: 0, quantity: 1 }],
      },
    ],
    events: [
      { type: 'order_created', title: 'Order created', occurredAt: '2026-07-14T15:00:00.000Z' },
      {
        type: 'shipment_packed',
        title: 'Shipment packed',
        shipmentNumber: 1,
        occurredAt: '2026-07-14T16:00:00.000Z',
      },
    ],
  },
  {
    key: 'alice-processing',
    userEmail: 'alice@example.com',
    createdAt: '2026-07-15T09:00:00.000Z',
    status: 'processing',
    version: 0,
    productLines: [{ productId: 1, quantity: 1 }],
    events: [
      { type: 'order_created', title: 'Order created', occurredAt: '2026-07-15T09:00:00.000Z' },
    ],
  },
  {
    key: 'alice-split-shipped',
    userEmail: 'alice@example.com',
    createdAt: '2026-07-14T09:00:00.000Z',
    status: 'shipped',
    version: 4,
    // Two lots, three sacks, split across two shipments: the first sack of lot 1 ships and
    // lands, the second sack plus lot 2 are still in transit. Partial-allocation QA coverage
    // depends on line 0 appearing in both shipments.
    productLines: [
      { productId: 1, quantity: 2 },
      { productId: 27, quantity: 1 },
    ],
    shipments: [
      {
        status: 'delivered',
        trackingReference: 'QA-ALICE-SPLIT-01',
        createdAt: '2026-07-14T10:00:00.000Z',
        updatedAt: '2026-07-16T12:00:00.000Z',
        version: 3,
        lines: [{ index: 0, quantity: 1 }],
      },
      {
        status: 'shipped',
        trackingReference: 'QA-ALICE-SPLIT-02',
        createdAt: '2026-07-14T10:00:00.000Z',
        updatedAt: '2026-07-16T09:00:00.000Z',
        version: 2,
        lines: [
          { index: 0, quantity: 1 },
          { index: 1, quantity: 1 },
        ],
      },
    ],
    events: [
      { type: 'order_created', title: 'Order created', occurredAt: '2026-07-14T09:00:00.000Z' },
      {
        type: 'shipment_packed',
        title: 'Shipment packed',
        shipmentNumber: 1,
        occurredAt: '2026-07-14T10:00:00.000Z',
      },
      {
        type: 'shipment_packed',
        title: 'Shipment packed',
        shipmentNumber: 2,
        occurredAt: '2026-07-14T10:00:00.000Z',
      },
      {
        type: 'shipment_shipped',
        title: 'Shipment shipped',
        shipmentNumber: 1,
        occurredAt: '2026-07-15T08:00:00.000Z',
      },
      {
        type: 'shipment_tracking_updated',
        title: 'Out for delivery',
        shipmentNumber: 1,
        code: 'out_for_delivery',
        detail: 'Simulated parcel is on its final route.',
        location: 'Demo depot',
        occurredAt: '2026-07-16T08:00:00.000Z',
      },
      {
        type: 'shipment_delivered',
        title: 'Shipment delivered',
        shipmentNumber: 1,
        occurredAt: '2026-07-16T12:00:00.000Z',
      },
      {
        type: 'shipment_shipped',
        title: 'Shipment shipped',
        shipmentNumber: 2,
        occurredAt: '2026-07-16T09:00:00.000Z',
      },
      {
        type: 'shipment_tracking_updated',
        title: 'In transit',
        shipmentNumber: 2,
        code: 'in_transit',
        detail: 'Simulated parcel has left the demo depot.',
        location: 'Demo transit hub',
        occurredAt: '2026-07-16T09:30:00.000Z',
      },
    ],
  },
  {
    key: 'alice-delivery-failed',
    userEmail: 'alice@example.com',
    createdAt: '2026-07-13T09:00:00.000Z',
    status: 'delivery_failed',
    version: 3,
    productLines: [{ productId: 27, quantity: 1 }],
    shipments: [
      {
        status: 'delivery_failed',
        trackingReference: 'QA-ALICE-FAILED-01',
        createdAt: '2026-07-13T10:00:00.000Z',
        updatedAt: '2026-07-14T15:00:00.000Z',
        version: 2,
        lines: [{ index: 0, quantity: 1 }],
      },
    ],
    events: [
      { type: 'order_created', title: 'Order created', occurredAt: '2026-07-13T09:00:00.000Z' },
      {
        type: 'shipment_packed',
        title: 'Shipment packed',
        shipmentNumber: 1,
        occurredAt: '2026-07-13T10:00:00.000Z',
      },
      {
        type: 'shipment_shipped',
        title: 'Shipment shipped',
        shipmentNumber: 1,
        occurredAt: '2026-07-14T08:00:00.000Z',
      },
      {
        type: 'shipment_delivery_failed',
        title: 'Shipment delivery failed',
        shipmentNumber: 1,
        occurredAt: '2026-07-14T15:00:00.000Z',
      },
    ],
  },
  {
    key: 'bob-delivered',
    userEmail: 'bob@example.com',
    createdAt: '2026-07-12T09:00:00.000Z',
    status: 'delivered',
    version: 3,
    productLines: [{ productId: 1, quantity: 1 }],
    shipments: [
      {
        status: 'delivered',
        trackingReference: 'QA-BOB-DELIVERED-01',
        createdAt: '2026-07-12T10:00:00.000Z',
        updatedAt: '2026-07-13T16:00:00.000Z',
        version: 2,
        lines: [{ index: 0, quantity: 1 }],
      },
    ],
    events: [
      { type: 'order_created', title: 'Order created', occurredAt: '2026-07-12T09:00:00.000Z' },
      {
        type: 'shipment_packed',
        title: 'Shipment packed',
        shipmentNumber: 1,
        occurredAt: '2026-07-12T10:00:00.000Z',
      },
      {
        type: 'shipment_shipped',
        title: 'Shipment shipped',
        shipmentNumber: 1,
        occurredAt: '2026-07-13T08:00:00.000Z',
      },
      {
        type: 'shipment_delivered',
        title: 'Shipment delivered',
        shipmentNumber: 1,
        occurredAt: '2026-07-13T16:00:00.000Z',
      },
    ],
  },
  {
    // Buy-again fixture: one past order that deliberately reorders into a mixed result.
    //
    // The order is placed on 2026-07-16, five days before the seeded clearance window on
    // `GDN-1043-001` opens (`seed.ts` anchors that window to `PRICING_PROMOTIONS_SEED_CLOCK`
    // = 2026-07-28, running from -7 to +7 days, i.e. 2026-07-21 to 2026-08-04). Reordering it
    // inside that window therefore discloses genuine downward price drift on line 0, while
    // line 1 is short of stock and line 2 re-adds cleanly:
    //   0. Lawn Feed        GDN-1043-001  stock 35, clearance active -> added, price drifted
    //   1. HMB Material     SPN-1007-001  stock 15, ordered 20       -> INSUFFICIENT_STOCK
    //   2. All-Purpose Flour BKP-0001-001 stock 85, ordered 4        -> added, price steady
    // Quantities clear the 4-sack MOQ floor and stay under the 1 t quantity-break tier, so the
    // resolved unit price is exactly the list or clearance price with no tier discount applied.
    key: 'alice-reorder-mix',
    userEmail: 'alice@example.com',
    createdAt: '2026-07-16T09:00:00.000Z',
    status: 'processing',
    version: 0,
    productLines: [
      { productId: 1043, quantity: 4 },
      { productId: 1007, quantity: 20 },
      { productId: 1, quantity: 4 },
    ],
    events: [
      { type: 'order_created', title: 'Order created', occurredAt: '2026-07-16T09:00:00.000Z' },
    ],
  },
];

function product(productId: number) {
  const item = CATALOG_PRODUCTS.find((candidate) => candidate.id === productId);
  if (!item) throw new Error(`Missing canonical product ${productId} for order seed scenario`);
  const defaultVariant =
    item.variants.find((v) => v.sortOrder === 1 && v.active) ?? item.variants[0];
  return {
    ...item,
    price_cents: defaultVariant?.priceCents ?? 0,
    variant: defaultVariant,
  };
}

/** Inserts immutable local-demo order fixtures once. Existing fixture state is never rewritten. */
export function seedOrderScenarios(db: Database.Database): void {
  const findUser = db.prepare(
    'SELECT id, display_name, email FROM users WHERE email = ? AND country = ?',
  );
  const insertOrder = db.prepare(`
    INSERT OR IGNORE INTO orders
      (customer_name, customer_email, shipping_address, subtotal_cents, discount_cents, total_cents, delivery_mode, delivery_charge_cents, delivery_weight_grams, created_at, user_id, lifecycle_status, version, demo_seed_key)
    VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findOrder = db.prepare('SELECT id FROM orders WHERE demo_seed_key = ?');
  const insertProductLine = db.prepare(`
    INSERT INTO order_line_items
      (order_id, product_id, product_name, product_price_cents, quantity, line_total_cents,
       discountable_total_cents, blending_fee_cents,
       variant_id, sku, variant_label, weight_grams, consumption_classification, delivery_class)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findVariantByProduct = db.prepare(
    'SELECT id, sku, label, weight_grams, delivery_class FROM product_variants WHERE product_id = ? AND sort_order = 1 AND active = 1 LIMIT 1',
  );
  const insertShipment = db.prepare(`
    INSERT INTO order_shipments
      (order_id, shipment_number, status, tracking_reference, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertProductAllocation = db.prepare(
    'INSERT INTO order_shipment_items (shipment_id, order_line_item_id, quantity) VALUES (?, ?, ?)',
  );
  const insertEvent = db.prepare(`
    INSERT INTO order_lifecycle_events
      (order_id, shipment_id, event_type, tracking_code, title, detail, location, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertPayment = db.prepare(`
    INSERT INTO payments
      (order_id, idempotency_key, request_fingerprint, status, amount_cents, card_last4, card_brand, created_at)
    VALUES (?, ?, ?, 'succeeded', ?, '4242', 'Visa', ?)
  `);

  for (const scenario of SCENARIOS) {
    const user = findUser.get(scenario.userEmail, LEGACY_DATA_COUNTRY) as
      { id: number; display_name: string; email: string } | undefined;
    if (!user) throw new Error(`Missing seeded user ${scenario.userEmail} for order scenario`);
    const productLines = scenario.productLines.map((line) => ({
      ...line,
      product: product(line.productId),
    }));
    const subtotalCents = productLines.reduce(
      (sum, line) => sum + line.product.price_cents * line.quantity,
      0,
    );

    // Delivery: all seeded orders use parcel
    const deliveryMode = 'parcel';
    const deliveryChargeCents = 0;
    const deliveryWeightGrams = productLines.reduce(
      (sum, line) => sum + (line.product.variant?.weightGrams ?? 1000) * line.quantity,
      0,
    );
    const totalCents = subtotalCents + deliveryChargeCents;

    const result = insertOrder.run(
      user.display_name,
      user.email,
      `1 ${scenario.key.replaceAll('-', ' ')} way, Demo City`,
      subtotalCents,
      totalCents,
      deliveryMode,
      deliveryChargeCents,
      deliveryWeightGrams,
      scenario.createdAt,
      user.id,
      scenario.status,
      scenario.version,
      scenario.key,
    );
    if (result.changes === 0) continue;

    const orderId = Number((findOrder.get(scenario.key) as { id: number }).id);
    const productLineIds = productLines.map((line) => {
      const variant = findVariantByProduct.get(line.product.id) as
        | { id: number; sku: string; label: string; weight_grams: number; delivery_class: string }
        | undefined;
      const consumptionClassification =
        CATALOG_PRODUCTS.find((p) => p.id === line.product.id)?.consumptionClassification ??
        'non-food';
      return Number(
        insertProductLine.run(
          orderId,
          line.product.id,
          line.product.name,
          line.product.price_cents,
          line.quantity,
          line.product.price_cents * line.quantity,
          // Demo fixtures are ordinary lines: fully discountable, never blended.
          line.product.price_cents * line.quantity,
          0,
          variant?.id ?? null,
          variant?.sku ?? null,
          variant?.label ?? null,
          variant?.weight_grams ?? null,
          consumptionClassification,
          variant?.delivery_class ?? 'parcel',
        ).lastInsertRowid,
      );
    });
    const shipmentIds = new Map<number, number>();
    for (const [index, shipment] of (scenario.shipments ?? []).entries()) {
      const shipmentNumber = index + 1;
      const shipmentId = Number(
        insertShipment.run(
          orderId,
          shipmentNumber,
          shipment.status,
          shipment.trackingReference,
          shipment.version,
          shipment.createdAt,
          shipment.updatedAt,
        ).lastInsertRowid,
      );
      shipmentIds.set(shipmentNumber, shipmentId);
      for (const line of shipment.lines) {
        insertProductAllocation.run(shipmentId, productLineIds[line.index], line.quantity);
      }
    }
    for (const event of scenario.events) {
      insertEvent.run(
        orderId,
        event.shipmentNumber === undefined ? null : (shipmentIds.get(event.shipmentNumber) ?? null),
        event.type,
        event.code ?? null,
        event.title,
        event.detail ?? null,
        event.location ?? null,
        event.occurredAt,
      );
    }
    insertPayment.run(
      orderId,
      `seed-payment-${scenario.key}`,
      `seed-payment-fingerprint-${scenario.key}`,
      subtotalCents,
      scenario.createdAt,
    );
  }
}
