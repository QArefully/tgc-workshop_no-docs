import { Type, type Static } from '@sinclair/typebox';
import { Uuid } from './common.js';

export const FREIGHT_WEIGHT_THRESHOLD_GRAMS = 100_000;
export const FREIGHT_CHARGE_CENTS = 999;
export const PARCEL_CHARGE_CENTS = 0;

/** Business days before the earliest bookable delivery date, by delivery mode. */
export const PARCEL_LEAD_TIME_BUSINESS_DAYS = 1;
export const FREIGHT_BASE_LEAD_TIME_BUSINESS_DAYS = 3;

/** Consignments at or above this weight need an extra freight-consolidation step. */
export const FREIGHT_HEAVY_WEIGHT_THRESHOLD_GRAMS = 1_000_000;
export const FREIGHT_HEAVY_LEAD_TIME_EXTRA_BUSINESS_DAYS = 2;

/** Business days from the earliest bookable date through the last offered date, inclusive. */
export const DELIVERY_SLOT_HORIZON_BUSINESS_DAYS = 15;

export const DeliveryMode = Type.Union([Type.Literal('parcel'), Type.Literal('freight')]);
export type DeliveryMode = Static<typeof DeliveryMode>;

export const DeliveryClass = Type.Union([Type.Literal('parcel'), Type.Literal('freight')]);
export type DeliveryClass = Static<typeof DeliveryClass>;

export const DeliverySummary = Type.Object(
  {
    mode: DeliveryMode,
    chargeCents: Type.Integer({ minimum: 0 }),
    weightGrams: Type.Integer({ minimum: 0 }),
    reason: Type.String({ minLength: 1, maxLength: 500 }),
  },
  { additionalProperties: false },
);
export type DeliverySummary = Static<typeof DeliverySummary>;

export const DeliveryQuoteInputLine = Type.Object(
  {
    deliveryClass: DeliveryClass,
    unitWeightGrams: Type.Integer({ minimum: 1 }),
    quantity: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);
export type DeliveryQuoteInputLine = Static<typeof DeliveryQuoteInputLine>;

/** Delivery quote request. Weight is derived solely from cart lines. */
export const DeliveryQuoteInput = Type.Object(
  {
    lines: Type.Array(DeliveryQuoteInputLine),
  },
  { additionalProperties: false },
);
export type DeliveryQuoteInput = Static<typeof DeliveryQuoteInput>;

/** Calendar date in UTC, `YYYY-MM-DD`. No timezone or locale profile exists. */
export const DeliveryDate = Type.String({
  minLength: 10,
  maxLength: 10,
  pattern: '^\\d{4}-\\d{2}-\\d{2}$',
});
export type DeliveryDate = Static<typeof DeliveryDate>;

export const DeliverySlotWindow = Type.Union([Type.Literal('am'), Type.Literal('pm')]);
export type DeliverySlotWindow = Static<typeof DeliverySlotWindow>;

/** Slot identity is date plus window only. There is no capacity or booking-count model. */
export const DeliverySlot = Type.Object(
  {
    date: DeliveryDate,
    window: DeliverySlotWindow,
  },
  { additionalProperties: false },
);
export type DeliverySlot = Static<typeof DeliverySlot>;

/** Derived freight lead time. `reason` is buyer-facing plain text. */
export const DeliveryLeadTime = Type.Object(
  {
    earliestDate: DeliveryDate,
    latestDate: DeliveryDate,
    businessDays: Type.Integer({ minimum: 0, maximum: 365 }),
    reason: Type.String({ minLength: 1, maxLength: 500, pattern: '^[^<>]*$' }),
  },
  { additionalProperties: false },
);
export type DeliveryLeadTime = Static<typeof DeliveryLeadTime>;

export const DeliverySlotOptionsQuery = Type.Object(
  { cartId: Uuid },
  { additionalProperties: false },
);
export type DeliverySlotOptionsQuery = Static<typeof DeliverySlotOptionsQuery>;

export const DeliverySlotOptionsResponse = Type.Object(
  {
    delivery: DeliverySummary,
    leadTime: DeliveryLeadTime,
    slots: Type.Array(DeliverySlot),
  },
  { additionalProperties: false },
);
export type DeliverySlotOptionsResponse = Static<typeof DeliverySlotOptionsResponse>;
