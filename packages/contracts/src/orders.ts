import { Type, type Static } from '@sinclair/typebox';
import { TypeSystem } from '@sinclair/typebox/system';
import { MoneyCents, PositiveIntegerString, PurchaseOrderReference, Uuid } from './common.js';
import { DeliveryClass, DeliveryMode, DeliverySlot } from './delivery.js';
import { CustomBlendSnapshot, ResolvedCustomBlendSnapshot } from './customBlends.js';
import { PostalAddress } from './address.js';
import { BillingEntitySnapshot } from './tradeAccount.js';
import { PaymentMethod } from './tradeCredit.js';
import { Country } from './country.js';

const UtcIsoInstant = Type.String({
  minLength: 24,
  maxLength: 24,
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$',
});
const NonNegativeVersion = Type.Integer({ minimum: 0 });
const TrackingReference = Type.String({ minLength: 1, maxLength: 100 });
/** Plain text transport fields exclude markup delimiters. */
const TrackingText = Type.String({ minLength: 1, maxLength: 500, pattern: '^[^<>]*$' });
const TrackingDetail = Type.String({ minLength: 1, maxLength: 2_000, pattern: '^[^<>]*$' });
const TrackingLocation = Type.String({ minLength: 1, maxLength: 160, pattern: '^[^<>]*$' });

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function safeProduct(left: unknown, right: unknown): number | undefined {
  if (!isSafeNonNegativeInteger(left) || !isSafeNonNegativeInteger(right)) return undefined;
  if (right > 0 && left > Math.floor(Number.MAX_SAFE_INTEGER / right)) return undefined;
  const result = left * right;
  return Number.isSafeInteger(result) ? result : undefined;
}

function safeSum(values: readonly unknown[]): number | undefined {
  let total = 0;
  for (const value of values) {
    if (!isSafeNonNegativeInteger(value) || value > Number.MAX_SAFE_INTEGER - total)
      return undefined;
    total += value;
  }
  return total;
}

export const OrderStatus = Type.Union([
  Type.Literal('processing'),
  Type.Literal('packed'),
  Type.Literal('shipped'),
  Type.Literal('delivered'),
  Type.Literal('delivery_failed'),
  Type.Literal('cancelled'),
]);
export type OrderStatus = Static<typeof OrderStatus>;

export const ShipmentStatus = Type.Union([
  Type.Literal('packed'),
  Type.Literal('shipped'),
  Type.Literal('delivered'),
  Type.Literal('delivery_failed'),
  Type.Literal('cancelled'),
]);
export type ShipmentStatus = Static<typeof ShipmentStatus>;

export const OrderLifecycleEventType = Type.Union([
  Type.Literal('order_created'),
  Type.Literal('shipment_packed'),
  Type.Literal('shipment_shipped'),
  Type.Literal('shipment_delivered'),
  Type.Literal('shipment_delivery_failed'),
  Type.Literal('shipment_tracking_updated'),
  Type.Literal('order_cancelled'),
]);
export type OrderLifecycleEventType = Static<typeof OrderLifecycleEventType>;

export const TrackingEventCode = Type.Union([
  Type.Literal('in_transit'),
  Type.Literal('out_for_delivery'),
  Type.Literal('delivery_attempted'),
  Type.Literal('delivered'),
]);
export type TrackingEventCode = Static<typeof TrackingEventCode>;

export const OrderInventoryStatus = Type.Union([
  Type.Literal('allocated'),
  Type.Literal('partially_backordered'),
  Type.Literal('backordered'),
  Type.Literal('cancelled'),
]);
export type OrderInventoryStatus = Static<typeof OrderInventoryStatus>;

export const OrderLineVariantSnapshot = Type.Object(
  {
    variantId: Type.Integer({ minimum: 1 }),
    sku: Type.String({ minLength: 1, maxLength: 64 }),
    label: Type.String({ minLength: 1, maxLength: 160 }),
    unitPriceCents: MoneyCents,
    weightGrams: Type.Integer({ minimum: 1 }),
    consumptionClassification: Type.Union([
      Type.Literal('food'),
      Type.Literal('non-food'),
      Type.Literal('caution'),
    ]),
    deliveryClass: DeliveryClass,
  },
  { additionalProperties: false },
);
export type OrderLineVariantSnapshot = Static<typeof OrderLineVariantSnapshot>;

const OrderLineItemFields = Type.Object(
  {
    lineId: PositiveIntegerString,
    productId: Type.String({ minLength: 1 }),
    productName: Type.String({ minLength: 1 }),
    unitPriceCents: MoneyCents,
    quantity: Type.Integer({ minimum: 1 }),
    discountableTotalCents: MoneyCents,
    blendingFeeCents: MoneyCents,
    lineTotalCents: MoneyCents,
    inventoryStatus: OrderInventoryStatus,
    allocatedQuantity: Type.Integer({ minimum: 0 }),
    backorderedQuantity: Type.Integer({ minimum: 0 }),
    variantSnapshot: Type.Optional(OrderLineVariantSnapshot),
    customBlend: Type.Optional(CustomBlendSnapshot),
  },
  { additionalProperties: false },
);

/**
 * Order lines freeze the same money split as the quote. Resolved snapshots carry a second copy of
 * their quantity-specific totals, so an unreadable or tampered order cannot silently disclose a
 * different amount. Legacy snapshots intentionally retain their historical, line-only pairing.
 */
const OrderLineMoneyIntegrity = TypeSystem.Type<unknown>(
  'OrderLineMoneyIntegrity',
  (_options, value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const line = value as {
      unitPriceCents?: unknown;
      quantity?: unknown;
      discountableTotalCents?: unknown;
      blendingFeeCents?: unknown;
      lineTotalCents?: unknown;
      customBlend?: unknown;
    };
    if (typeof line.customBlend !== 'object' || line.customBlend === null) return true;
    const blend = line.customBlend as Partial<Static<typeof ResolvedCustomBlendSnapshot>> & {
      ruleVersion?: unknown;
    };
    // Legacy order snapshots intentionally retain the old line-only shape and its historical
    // money semantics. Only a V9/resolved snapshot adds the cross-field arithmetic invariant.
    if (blend.ruleVersion !== 1) return true;
    return (
      safeProduct(line.unitPriceCents, line.quantity) === line.discountableTotalCents &&
      safeSum([line.discountableTotalCents, line.blendingFeeCents]) === line.lineTotalCents &&
      blend.quantity === line.quantity &&
      blend.materialUnitPriceCents === line.unitPriceCents &&
      blend.materialSubtotalCents === line.discountableTotalCents &&
      blend.discountableTotalCents === line.discountableTotalCents &&
      blend.lineTotalCents === line.lineTotalCents &&
      blend.blendingFeeCents === line.blendingFeeCents
    );
  },
);

export const OrderLineItem = Type.Intersect([OrderLineItemFields, OrderLineMoneyIntegrity()]);
export type OrderLineItem = Static<typeof OrderLineItem>;

const OrderFields = Type.Object(
  {
    id: PositiveIntegerString,
    status: OrderStatus,
    version: NonNegativeVersion,
    /** Identity country frozen at checkout; omitted only by pre-localisation transport fixtures. */
    country: Type.Optional(Country),
    items: Type.Array(OrderLineItem),
    subtotalCents: MoneyCents,
    discountCents: MoneyCents,
    totalCents: MoneyCents,
    /** Present on new orders; omitted on historic card/legacy rows. */
    paymentMethod: Type.Optional(PaymentMethod),
    /** Company identity is present only for a company trade-credit order. */
    companyId: Type.Optional(PositiveIntegerString),
    /** VAT accounting is optional for legacy rows and complete when present. */
    netCents: Type.Optional(MoneyCents),
    vatRateBasisPoints: Type.Optional(Type.Integer({ minimum: 0, maximum: 10_000 })),
    vatCents: Type.Optional(MoneyCents),
    grossCents: Type.Optional(MoneyCents),
    promoApplied: Type.Union([Type.String(), Type.Null()]),
    promoCategoryScope: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
    discountBaseCents: Type.Optional(MoneyCents),
    createdAt: UtcIsoInstant,
    deliveryMode: Type.Optional(DeliveryMode),
    deliveryChargeCents: Type.Optional(Type.Integer({ minimum: 0 })),
    deliveryWeightGrams: Type.Optional(Type.Integer({ minimum: 0 })),
    // Optional so orders placed before checkout captured these values stay representable.
    deliveryAddress: Type.Optional(PostalAddress),
    billingEntity: Type.Optional(BillingEntitySnapshot),
    deliverySlot: Type.Optional(DeliverySlot),
    purchaseOrderReference: Type.Optional(PurchaseOrderReference),
  },
  { additionalProperties: false },
);

const OrderAccountingIntegrity = TypeSystem.Type<unknown>(
  'OrderAccountingIntegrity',
  (_options, value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const order = value as {
      paymentMethod?: unknown;
      companyId?: unknown;
      country?: unknown;
      totalCents?: unknown;
      netCents?: unknown;
      vatRateBasisPoints?: unknown;
      vatCents?: unknown;
      grossCents?: unknown;
    };
    const fields = [order.netCents, order.vatRateBasisPoints, order.vatCents, order.grossCents];
    const anyVatField = fields.some((field) => field !== undefined);
    if (!anyVatField) {
      // A legacy row has no method, company, or accounting fields. Once a method/company is
      // exposed, all four accounting fields must be present together; a partial tuple must never
      // be mistaken for a legacy row.
      return order.paymentMethod === undefined && order.companyId === undefined;
    }
    if (order.paymentMethod !== 'trade_credit' && order.paymentMethod !== 'card') return false;
    // Every non-legacy accounting tuple carries the checkout identity country that owns its VAT
    // basis. The outer object schema validates the supported-country value; this callback makes
    // omission fail closed while still allowing old null-column rows through.
    if (typeof order.country !== 'string') return false;
    const safeMoney = (candidate: unknown): candidate is number =>
      typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= 0;
    if (
      !safeMoney(order.totalCents) ||
      !safeMoney(order.netCents) ||
      !safeMoney(order.vatCents) ||
      !safeMoney(order.grossCents) ||
      typeof order.vatRateBasisPoints !== 'number' ||
      !Number.isSafeInteger(order.vatRateBasisPoints) ||
      order.vatRateBasisPoints < 0 ||
      order.vatRateBasisPoints > 10_000 ||
      (order.paymentMethod === 'trade_credit' && typeof order.companyId !== 'string') ||
      (order.paymentMethod === 'card' && order.companyId !== undefined) ||
      order.paymentMethod === undefined
    ) {
      return false;
    }
    if (
      order.vatRateBasisPoints > 0 &&
      order.netCents > Math.floor(Number.MAX_SAFE_INTEGER / order.vatRateBasisPoints)
    ) {
      return false;
    }
    const vatNumerator = order.netCents * order.vatRateBasisPoints;
    if (!Number.isSafeInteger(vatNumerator) || vatNumerator > Number.MAX_SAFE_INTEGER - 5_000)
      return false;
    const expectedVat = Math.floor((vatNumerator + 5_000) / 10_000);
    return (
      expectedVat === order.vatCents &&
      (order.paymentMethod !== 'card' || order.vatRateBasisPoints === 0) &&
      order.netCents <= Number.MAX_SAFE_INTEGER - order.vatCents &&
      order.netCents + order.vatCents === order.grossCents &&
      order.grossCents === order.totalCents
    );
  },
);

/** Customer order transport with optional VAT/accounting fields and strict credit integrity. */
export const Order = Type.Intersect([OrderFields, OrderAccountingIntegrity()]);
export type Order = Static<typeof Order>;
export const OrderWithAccounting = Order;
export type OrderWithAccounting = Order;

const OrderSummaryFields = Type.Object(
  {
    id: PositiveIntegerString,
    status: OrderStatus,
    version: NonNegativeVersion,
    /** Identity country frozen at checkout; omitted only by pre-localisation transport fixtures. */
    country: Type.Optional(Country),
    totalCents: MoneyCents,
    paymentMethod: Type.Optional(PaymentMethod),
    companyId: Type.Optional(PositiveIntegerString),
    netCents: Type.Optional(MoneyCents),
    vatRateBasisPoints: Type.Optional(Type.Integer({ minimum: 0, maximum: 10_000 })),
    vatCents: Type.Optional(MoneyCents),
    grossCents: Type.Optional(MoneyCents),
    totalItems: Type.Integer({ minimum: 0 }),
    hasBackorder: Type.Boolean(),
    createdAt: UtcIsoInstant,
    // Optional so orders placed before checkout captured a reference stay representable.
    purchaseOrderReference: Type.Optional(PurchaseOrderReference),
  },
  { additionalProperties: false },
);
// Keep `.properties` available to schema extensions (admin order responses) without making it a
// second enumerable object schema beside `allOf`; fast-json-stringify cannot merge those duplicate
// nested object trees when serializing order details.
export const OrderSummary = Object.defineProperty(
  Type.Intersect([OrderSummaryFields, OrderAccountingIntegrity()]),
  'properties',
  { value: OrderSummaryFields.properties },
);
export type OrderSummary = Static<typeof OrderSummary>;

export const OrderListQuery = Type.Object(
  {
    page: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000 })),
    pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
  },
  { additionalProperties: false },
);
export type OrderListQuery = Static<typeof OrderListQuery>;

export const OrderListResponse = Type.Object(
  {
    items: Type.Array(OrderSummary),
    page: Type.Integer({ minimum: 1, maximum: 10_000 }),
    pageSize: Type.Integer({ minimum: 1, maximum: 50 }),
  },
  { additionalProperties: false },
);
export type OrderListResponse = Static<typeof OrderListResponse>;

/** Allocation of one order line item to a shipment. `lineId` always names an order line item. */
export const OrderShipmentLine = Type.Object(
  {
    lineId: PositiveIntegerString,
    quantity: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);
export type OrderShipmentLine = Static<typeof OrderShipmentLine>;

export const OrderShipment = Type.Object(
  {
    id: PositiveIntegerString,
    shipmentNumber: Type.Integer({ minimum: 1 }),
    status: ShipmentStatus,
    trackingReference: Type.Union([TrackingReference, Type.Null()]),
    version: NonNegativeVersion,
    lines: Type.Array(OrderShipmentLine),
    createdAt: UtcIsoInstant,
    updatedAt: UtcIsoInstant,
  },
  { additionalProperties: false },
);
export type OrderShipment = Static<typeof OrderShipment>;

export const OrderLifecycleEvent = Type.Object(
  {
    id: PositiveIntegerString,
    shipmentId: Type.Union([PositiveIntegerString, Type.Null()]),
    type: OrderLifecycleEventType,
    code: Type.Union([TrackingEventCode, Type.Null()]),
    title: TrackingText,
    detail: Type.Union([TrackingDetail, Type.Null()]),
    location: Type.Union([TrackingLocation, Type.Null()]),
    occurredAt: UtcIsoInstant,
  },
  { additionalProperties: false },
);
export type OrderLifecycleEvent = Static<typeof OrderLifecycleEvent>;

const OrderDetailFields = Type.Object(
  {
    ...OrderFields.properties,
    shipments: Type.Array(OrderShipment),
    events: Type.Array(OrderLifecycleEvent),
    canCancel: Type.Boolean(),
  },
  { additionalProperties: false },
);
export const OrderDetailResponse = Object.defineProperty(
  Type.Intersect([OrderDetailFields, OrderAccountingIntegrity()]),
  'properties',
  { value: OrderDetailFields.properties },
);
export type OrderDetailResponse = Static<typeof OrderDetailResponse>;

export const CancelOrderBody = Type.Object(
  { version: NonNegativeVersion, idempotencyKey: Uuid },
  { additionalProperties: false },
);
export type CancelOrderBody = Static<typeof CancelOrderBody>;

export const PackShipmentBody = Type.Object(
  {
    trackingReference: Type.Optional(TrackingReference),
    lines: Type.Array(OrderShipmentLine, { minItems: 1, maxItems: 100 }),
  },
  { additionalProperties: false },
);
export type PackShipmentBody = Static<typeof PackShipmentBody>;

export const PackOrderBody = Type.Object(
  {
    version: NonNegativeVersion,
    idempotencyKey: Uuid,
    shipments: Type.Array(PackShipmentBody, { minItems: 1, maxItems: 50 }),
  },
  { additionalProperties: false },
);
export type PackOrderBody = Static<typeof PackOrderBody>;

export const ShipmentTransitionStatus = Type.Union([
  Type.Literal('shipped'),
  Type.Literal('delivered'),
  Type.Literal('delivery_failed'),
]);
export type ShipmentTransitionStatus = Static<typeof ShipmentTransitionStatus>;

export const TransitionShipmentBody = Type.Object(
  {
    version: NonNegativeVersion,
    status: ShipmentTransitionStatus,
    idempotencyKey: Uuid,
  },
  { additionalProperties: false },
);
export type TransitionShipmentBody = Static<typeof TransitionShipmentBody>;

export const CreateTrackingEventBody = Type.Object(
  {
    version: NonNegativeVersion,
    code: TrackingEventCode,
    title: TrackingText,
    detail: Type.Optional(TrackingDetail),
    location: Type.Optional(TrackingLocation),
    idempotencyKey: Uuid,
  },
  { additionalProperties: false },
);
export type CreateTrackingEventBody = Static<typeof CreateTrackingEventBody>;

export const PlaceOrderResponse = Order;
export type PlaceOrderResponse = Static<typeof PlaceOrderResponse>;

export const OrderIdParam = Type.Object(
  { orderId: PositiveIntegerString },
  { additionalProperties: false },
);
export type OrderIdParam = Static<typeof OrderIdParam>;

export const ShipmentIdParam = Type.Object(
  { shipmentId: PositiveIntegerString },
  { additionalProperties: false },
);
export type ShipmentIdParam = Static<typeof ShipmentIdParam>;

/** Cross-buyer administrator list filters. Customer order endpoints remain owner-scoped. */
export const AdminOrderListQuery = Type.Object(
  {
    status: Type.Optional(OrderStatus),
    userEmail: Type.Optional(Type.String({ minLength: 3, maxLength: 254 })),
    promoCode: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    occurredFrom: Type.Optional(UtcIsoInstant),
    occurredTo: Type.Optional(UtcIsoInstant),
    page: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000 })),
    pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);
export type AdminOrderListQuery = Static<typeof AdminOrderListQuery>;
