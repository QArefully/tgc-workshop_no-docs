import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import {
  CancelOrderBody,
  CreateTrackingEventBody,
  OrderDetailResponse,
  OrderLifecycleEventType,
  OrderListQuery,
  PackOrderBody,
  ShipmentStatus,
  TransitionShipmentBody,
} from '../src/orders.js';

const uuid = '123e4567-e89b-42d3-a456-426614174000';
const occurredAt = '2026-07-19T12:00:00.000Z';

const order = {
  id: '1',
  status: 'packed',
  version: 1,
  items: [
    {
      lineId: '11',
      productId: '1',
      productName: 'Immutable product',
      unitPriceCents: 1200,
      quantity: 2,
      discountableTotalCents: 2400,
      blendingFeeCents: 0,
      lineTotalCents: 2400,
      inventoryStatus: 'allocated',
      allocatedQuantity: 2,
      backorderedQuantity: 0,
    },
  ],
  subtotalCents: 2400,
  discountCents: 0,
  totalCents: 2400,
  promoApplied: null,
  createdAt: occurredAt,
  shipments: [
    {
      id: '10',
      shipmentNumber: 1,
      status: 'packed',
      trackingReference: 'SIM-001',
      version: 0,
      lines: [{ lineId: '11', quantity: 2 }],
      createdAt: occurredAt,
      updatedAt: occurredAt,
    },
  ],
  events: [
    {
      id: '100',
      shipmentId: '10',
      type: 'shipment_packed',
      code: null,
      title: 'Shipment packed',
      detail: null,
      location: null,
      occurredAt,
    },
  ],
  canCancel: true,
};

const legacyBlend = {
  configKey: 'a'.repeat(64),
  basePercentage: 80,
  mixingGroup: 'food-grade',
  ingredients: [
    {
      variantId: 2,
      productId: '2',
      productName: 'Cocoa powder',
      productDescription: 'Unsweetened cocoa powder',
      mixingGroup: 'food-grade',
      percentage: 20,
    },
  ],
  blendingFeeCents: 2500,
  madeToOrder: true,
  returnable: false,
};

const resolvedBlend = {
  ...legacyBlend,
  ruleVersion: 1,
  resultClassification: 'food',
  quantity: 4,
  components: [
    {
      role: 'base',
      variantId: 1,
      productId: '1',
      productName: 'Immutable product',
      mixingGroup: 'food-grade',
      consumptionClassification: 'food',
      percentage: 80,
      weightGrams: 80_000,
      sourceUnitPriceCents: 2500,
      tierDiscountPct: 0,
      unitContributionCents: 2000,
      subtotalCents: 8000,
    },
    {
      role: 'ingredient',
      variantId: 2,
      productId: '2',
      productName: 'Cocoa powder',
      mixingGroup: 'food-grade',
      consumptionClassification: 'food',
      percentage: 20,
      weightGrams: 20_000,
      sourceUnitPriceCents: 1500,
      tierDiscountPct: 0,
      unitContributionCents: 300,
      subtotalCents: 1200,
    },
  ],
  materialUnitPriceCents: 2300,
  materialSubtotalCents: 9200,
  discountableTotalCents: 9200,
  lineTotalCents: 11_700,
};

void test('order detail accepts lifecycle and split-shipment line allocation data', () => {
  assert.equal(Value.Check(OrderDetailResponse, order), true);
  assert.equal(
    Value.Check(OrderDetailResponse, {
      ...order,
      shipments: [
        ...order.shipments,
        {
          ...order.shipments[0],
          id: '12',
          shipmentNumber: 2,
          trackingReference: null,
          lines: [{ lineId: '11', quantity: 1 }],
        },
      ],
    }),
    true,
  );
});

void test('order lifecycle schemas reject invalid statuses and non-strict payloads', () => {
  assert.equal(Value.Check(ShipmentStatus, 'packed'), true);
  assert.equal(Value.Check(ShipmentStatus, 'processing'), false);
  assert.equal(Value.Check(OrderLifecycleEventType, 'shipment_tracking_updated'), true);
  assert.equal(Value.Check(OrderLifecycleEventType, 'tracking_updated'), false);
  assert.equal(Value.Check(OrderDetailResponse, { ...order, status: 'unknown' }), false);
  assert.equal(Value.Check(OrderDetailResponse, { ...order, unknown: true }), false);
  assert.equal(Value.Check(OrderListQuery, { page: 0 }), false);
  assert.equal(Value.Check(OrderListQuery, { page: 1, pageSize: 51 }), false);
});

void test('order lines preserve legacy blend snapshots and validate resolved totals', () => {
  const legacyLine = {
    ...order.items[0],
    // Historic rows are accepted without retroactively imposing V9 arithmetic on their totals.
    discountableTotalCents: 1,
    lineTotalCents: 1,
    customBlend: legacyBlend,
  };
  assert.equal(Value.Check(OrderDetailResponse, { ...order, items: [legacyLine] }), true);

  const resolvedLine = {
    ...order.items[0],
    unitPriceCents: 2300,
    quantity: 4,
    discountableTotalCents: 9200,
    blendingFeeCents: 2500,
    lineTotalCents: 11_700,
    customBlend: resolvedBlend,
  };
  assert.equal(Value.Check(OrderDetailResponse, { ...order, items: [resolvedLine] }), true);
  const zeroFeeResolvedBlend = {
    ...resolvedBlend,
    blendingFeeCents: 0,
    lineTotalCents: resolvedBlend.materialSubtotalCents,
  };
  assert.equal(
    Value.Check(OrderDetailResponse, {
      ...order,
      items: [
        {
          ...resolvedLine,
          blendingFeeCents: 0,
          lineTotalCents: resolvedBlend.materialSubtotalCents,
          customBlend: zeroFeeResolvedBlend,
        },
      ],
    }),
    false,
  );
  assert.equal(
    Value.Check(OrderDetailResponse, {
      ...order,
      items: [{ ...resolvedLine, lineTotalCents: 11_701 }],
    }),
    false,
  );
  assert.equal(
    Value.Check(OrderDetailResponse, {
      ...order,
      items: [
        {
          ...resolvedLine,
          customBlend: {
            ...resolvedBlend,
            components: [
              { ...resolvedBlend.components[0], unexpected: true },
              resolvedBlend.components[1],
            ],
          },
        },
      ],
    }),
    false,
  );
});

void test('lifecycle mutation payloads enforce UUID keys, bounds, and allowed transitions', () => {
  assert.equal(Value.Check(CancelOrderBody, { version: 0, idempotencyKey: uuid }), true);
  assert.equal(Value.Check(CancelOrderBody, { version: -1, idempotencyKey: uuid }), false);
  assert.equal(
    Value.Check(PackOrderBody, {
      version: 0,
      idempotencyKey: uuid,
      shipments: [
        {
          trackingReference: 'SIM-002',
          lines: [{ lineId: '11', quantity: 2 }],
        },
      ],
    }),
    true,
  );
  assert.equal(
    Value.Check(PackOrderBody, {
      version: 0,
      idempotencyKey: uuid,
      shipments: [{ lines: [{ lineId: '11', quantity: 0 }] }],
    }),
    false,
  );
  assert.equal(
    Value.Check(PackOrderBody, {
      version: 0,
      idempotencyKey: uuid,
      shipments: [{ lines: [{ lineId: '11', quantity: 1, lineKind: 'product' }] }],
    }),
    false,
  );
  assert.equal(
    Value.Check(TransitionShipmentBody, {
      version: 0,
      status: 'cancelled',
      idempotencyKey: uuid,
    }),
    false,
  );
  assert.equal(
    Value.Check(CreateTrackingEventBody, {
      version: 0,
      code: 'in_transit',
      title: 'In transit',
      idempotencyKey: uuid,
    }),
    true,
  );
  assert.equal(
    Value.Check(CreateTrackingEventBody, {
      version: 0,
      code: 'unknown',
      title: 'Unknown',
      idempotencyKey: uuid,
    }),
    false,
  );
  assert.equal(
    Value.Check(CreateTrackingEventBody, {
      version: 0,
      code: 'in_transit',
      title: '<strong>In transit</strong>',
      detail: 'At <Depot>',
      location: 'London',
      idempotencyKey: uuid,
    }),
    false,
  );
});
