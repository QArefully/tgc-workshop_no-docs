import type { PostalAddress } from '@shop/contracts/address';
import type { Country } from '@shop/contracts/country';
import type { CustomBlendSnapshot } from '@shop/contracts/custom-blends';
import type { DeliverySlot } from '@shop/contracts/delivery';
import type { BillingEntitySnapshot } from '@shop/contracts/trade-account';
import type {
  OrderLifecycleEventType,
  OrderShipmentLine,
  OrderStatus,
  ShipmentStatus,
  TrackingEventCode,
} from '@shop/contracts/orders';

export interface CreateOrderLineVariantSnapshot {
  variantId: number;
  sku: string;
  label: string;
  weightGrams: number;
  consumptionClassification: 'food' | 'non-food' | 'caution';
  deliveryClass: 'parcel' | 'freight';
}

export interface CreateOrderParams {
  /** Identity country captured from the cart/checkout quote; never the admin browsing country. */
  country: Country;
  customerName: string;
  customerEmail: string;
  shippingAddress: string;
  promoApplied: string | null;
  promoCategoryScope?: string | null;
  subtotalCents: number;
  discountBaseCents?: number | null;
  discountCents: number;
  totalCents: number;
  /** Payment/accounting facts frozen by the checkout quote. Historic callers may omit these. */
  paymentMethod?: 'card' | 'trade_credit';
  companyId?: number | null;
  netCents?: number | null;
  vatRateBasisPoints?: number | null;
  vatCents?: number | null;
  grossCents?: number | null;
  userId: number | null;
  items: Array<{
    productId: string;
    productName: string;
    unitPriceCents: number;
    quantity: number;
    /**
     * Promotion base for this line. Equals `lineTotalCents` on ordinary lines; on a configured
     * Custom Blend line it excludes the blending fee, which is a service charge and never
     * discountable, refundable, or a weight in refund discount proration.
     */
    discountableTotalCents: number;
    /** One-off blending service charge. Always `0` on ordinary lines. */
    blendingFeeCents: number;
    lineTotalCents: number;
    variantSnapshot?: CreateOrderLineVariantSnapshot;
    /** Frozen Custom Blend specification. Present only on configured lines. */
    customBlend?: CustomBlendSnapshot;
  }>;
  deliveryMode?: 'parcel' | 'freight';
  deliveryChargeCents?: number;
  deliveryWeightGrams?: number;
  /**
   * The B2B checkout commitments, all optional so an order created by a path that does not capture
   * them (seed data, historic rows) stays representable. `shippingAddress` above is the rendering
   * of `deliveryAddress`; the caller derives it through the shared formatter, never independently.
   */
  deliverySiteId?: number | null;
  deliveryAddress?: PostalAddress | null;
  billingEntity?: BillingEntitySnapshot | null;
  deliverySlot?: DeliverySlot | null;
  purchaseOrderReference?: string | null;
  createdAt: string;
}

export interface ShipmentAllocation {
  trackingReference?: string;
  lines: OrderShipmentLine[];
}

export interface LifecycleEventInput {
  orderId: number;
  shipmentId?: number;
  type: OrderLifecycleEventType;
  title: string;
  detail?: string;
  location?: string;
  code?: TrackingEventCode;
  idempotencyKey?: string;
  requestFingerprint?: string;
  occurredAt: string;
}

export interface PersistedShipment {
  id: number;
  orderId: number;
  shipmentNumber: number;
  status: ShipmentStatus;
  trackingReference: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrderState {
  id: number;
  status: OrderStatus;
  version: number;
  cancelledAt: string | null;
}
