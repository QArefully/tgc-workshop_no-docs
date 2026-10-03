import type Database from 'better-sqlite3';
import type { TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { PostalAddress } from '@shop/contracts/address';
import { CustomBlendSnapshot } from '@shop/contracts/custom-blends';
import { DeliverySlot } from '@shop/contracts/delivery';
import { BillingEntitySnapshot } from '@shop/contracts/trade-account';
import type {
  Order,
  OrderDetailResponse,
  OrderLifecycleEvent,
  OrderLineItem,
  OrderLineVariantSnapshot,
  OrderShipment,
  OrderStatus,
  OrderSummary,
  ShipmentStatus,
} from '@shop/contracts/orders';
import type { ResolvedCustomBlendSnapshot } from '@shop/contracts/custom-blends';
import type { Country } from '@shop/contracts/country';
import { orderLifecycleTitle } from '@shop/localisation/messages/asyncContent';
import type { CreateOrderParams, LifecycleEventInput, PersistedShipment } from './orderTypes.js';

interface OrderRow {
  id: number;
  country: Country;
  promo_code_applied: string | null;
  promo_category_scope: string | null;
  subtotal_cents: number;
  discount_base_cents: number | null;
  discount_cents: number;
  total_cents: number;
  payment_method: 'card' | 'trade_credit';
  company_id: number | null;
  net_cents: number | null;
  vat_rate_basis_points: number | null;
  vat_cents: number | null;
  gross_cents: number | null;
  created_at: string;
  lifecycle_status: OrderStatus;
  version: number;
  cancelled_at: string | null;
  user_id: number | null;
  delivery_mode: string | null;
  delivery_charge_cents: number | null;
  delivery_weight_grams: number | null;
  delivery_site_id: number | null;
  delivery_address_json: string | null;
  billing_entity_json: string | null;
  delivery_slot_date: string | null;
  delivery_slot_window: string | null;
  purchase_order_reference: string | null;
}
interface ProductLineRow {
  id: number;
  product_id: number;
  product_name: string;
  product_price_cents: number;
  quantity: number;
  line_total_cents: number;
  discountable_total_cents: number;
  blending_fee_cents: number;
  custom_blend_json: string | null;
  allocated_quantity?: number | null;
  backordered_quantity?: number | null;
  cancelled_quantity?: number | null;
  variant_id?: number | null;
  sku?: string | null;
  variant_label?: string | null;
  weight_grams?: number | null;
  consumption_classification?: string | null;
  delivery_class?: string | null;
}
interface ShipmentRow {
  id: number;
  order_id: number;
  shipment_number: number;
  status: ShipmentStatus;
  tracking_reference: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}
interface EventRow {
  id: number;
  shipment_id: number | null;
  event_type: OrderLifecycleEvent['type'];
  tracking_code: OrderLifecycleEvent['code'];
  title: string;
  detail: string | null;
  location: string | null;
  occurred_at: string;
  idempotency_key: string | null;
  request_fingerprint: string | null;
}

type AccountingRow = Pick<
  OrderRow,
  | 'id'
  | 'payment_method'
  | 'company_id'
  | 'net_cents'
  | 'vat_rate_basis_points'
  | 'vat_cents'
  | 'gross_cents'
  | 'total_cents'
>;

export interface OrderAccessRepository {
  replaceAccessGrant(input: {
    orderId: number;
    tokenDigest: string;
    expiresAt: string;
    createdAt: string;
  }): void;
  hasValidAccessGrant(orderId: number, tokenDigest: string, now: string): boolean;
}

export interface OrderRepository extends OrderAccessRepository {
  create(params: CreateOrderParams): number;
  /** Identity country frozen on the order, independent of the current browsing country. */
  country(orderId: number): Country | undefined;
  findById(orderId: number): Order | undefined;
  findDetailById(orderId: number, country?: Country): OrderDetailResponse | undefined;
  findOwnedDetail(orderId: number, userId: number): OrderDetailResponse | undefined;
  listOwned(
    userId: number,
    page: number,
    pageSize: number,
  ): { items: OrderSummary[]; total: number };
  /** Full, deterministic export view. Unlike paginated account history, this avoids one query per order. */
  listExportOwned(userId: number): Order[];
  getOrderState(
    orderId: number,
  ): { id: number; status: OrderStatus; version: number; cancelledAt: string | null } | undefined;
  getShipment(shipmentId: number): PersistedShipment | undefined;
  listShipments(orderId: number): PersistedShipment[];
  listAllocatableLines(orderId: number): Array<{ lineId: string; quantity: number }>;
  hasOutstandingBackorder(orderId: number): boolean;
  insertShipment(input: {
    orderId: number;
    shipmentNumber: number;
    trackingReference: string | null;
    createdAt: string;
  }): number;
  insertShipmentLine(input: { shipmentId: number; lineId: number; quantity: number }): void;
  updateShipmentStatus(input: {
    shipmentId: number;
    expectedVersion: number;
    status: ShipmentStatus;
    updatedAt: string;
  }): boolean;
  touchShipment(input: { shipmentId: number; expectedVersion: number; updatedAt: string }): boolean;
  updateOrderStatus(input: {
    orderId: number;
    expectedVersion: number;
    status: OrderStatus;
    cancelledAt?: string | null;
  }): boolean;
  cancelPackedShipments(orderId: number, updatedAt: string): void;
  insertEvent(input: LifecycleEventInput): number;
  findEventByIdempotencyKey(
    key: string,
  ): { orderId: number; requestFingerprint: string } | undefined;
}

/**
 * Storage-boundary parser for the frozen Custom Blend specification on an order line.
 *
 * Fails closed: an order is a financial record, so unreadable, schema-invalid, or
 * money-inconsistent snapshot JSON must surface as an error rather than degrade the line
 * into an ordinary one. Backfilled and plain rows store `NULL` and hydrate to `undefined`.
 */
function hydrateOrderCustomBlend(row: ProductLineRow): CustomBlendSnapshot | undefined {
  if (row.custom_blend_json === null) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.custom_blend_json);
  } catch {
    throw new Error(`Order line ${row.id} has an unreadable Custom Blend snapshot`);
  }
  if (!Value.Check(CustomBlendSnapshot, parsed)) {
    throw new Error(`Order line ${row.id} has an invalid Custom Blend snapshot`);
  }
  if (parsed.blendingFeeCents !== row.blending_fee_cents) {
    throw new Error(
      `Order line ${row.id} Custom Blend fee disagrees with its persisted line money`,
    );
  }
  if (isResolvedCustomBlendSnapshot(parsed) && !resolvedSnapshotMatchesOrderLine(row, parsed)) {
    throw new Error(
      `Order line ${row.id} Custom Blend resolved snapshot disagrees with its persisted line facts`,
    );
  }
  return parsed;
}

function isResolvedCustomBlendSnapshot(
  value: CustomBlendSnapshot,
): value is ResolvedCustomBlendSnapshot {
  return 'ruleVersion' in value && value.ruleVersion === 1;
}

/**
 * A resolved snapshot is a frozen financial outcome. Its quantity, classification, base identity,
 * and all line money must remain paired with the order columns; legacy specification-only snapshots
 * deliberately skip this check so historic rows remain readable.
 */
function resolvedSnapshotMatchesOrderLine(
  row: ProductLineRow,
  snapshot: ResolvedCustomBlendSnapshot,
): boolean {
  const base = snapshot.components.find((component) => component.role === 'base');
  return (
    base !== undefined &&
    base.variantId === row.variant_id &&
    base.productId === String(row.product_id) &&
    base.productName === row.product_name &&
    (base.sku === undefined || base.sku === row.sku) &&
    (base.variantLabel === undefined || base.variantLabel === row.variant_label) &&
    snapshot.quantity === row.quantity &&
    snapshot.resultClassification === row.consumption_classification &&
    snapshot.materialUnitPriceCents === row.product_price_cents &&
    snapshot.materialSubtotalCents === row.discountable_total_cents &&
    snapshot.discountableTotalCents === row.discountable_total_cents &&
    snapshot.blendingFeeCents === row.blending_fee_cents &&
    snapshot.lineTotalCents === row.line_total_cents
  );
}

/**
 * Storage-boundary parser for a JSON snapshot column on an order.
 *
 * Fails closed for the same reason as the Custom Blend snapshot: an order is a financial record, so
 * unreadable or schema-invalid delivery/billing JSON must surface as an error rather than silently
 * hydrate as an order that was never told where it was going or who was billed.
 */
function hydrateOrderSnapshot<T>(
  orderId: number,
  column: string,
  schema: TSchema,
  json: string | null,
): T | undefined {
  if (json === null) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`Order ${orderId} has an unreadable ${column}`);
  }
  if (!Value.Check(schema, parsed)) {
    throw new Error(`Order ${orderId} has an invalid ${column}`);
  }
  return parsed as T;
}

/** Slot identity is date plus window; a half-written pair is corruption, not a partial booking. */
function hydrateOrderSlot(row: OrderRow): DeliverySlot | undefined {
  if (row.delivery_slot_date === null && row.delivery_slot_window === null) return undefined;
  const slot = { date: row.delivery_slot_date, window: row.delivery_slot_window };
  if (!Value.Check(DeliverySlot, slot)) {
    throw new Error(`Order ${row.id} has an invalid delivery slot`);
  }
  return slot;
}

function hydrateOrderAccounting(
  row: AccountingRow,
): Pick<
  Order,
  'paymentMethod' | 'companyId' | 'netCents' | 'vatRateBasisPoints' | 'vatCents' | 'grossCents'
> {
  if (row.payment_method !== 'card' && row.payment_method !== 'trade_credit') {
    throw new Error(`Order ${row.id} has an invalid payment method`);
  }
  const facts = [row.net_cents, row.vat_rate_basis_points, row.vat_cents, row.gross_cents];
  const populated = facts.filter((fact) => fact !== null).length;
  if (populated === 0) {
    // Null accounting columns identify a historic card row. A company id alongside those nulls
    // is a malformed partial snapshot, not a legacy row that can safely be downgraded.
    if (row.payment_method !== 'card' || row.company_id !== null) {
      throw new Error(
        row.payment_method === 'trade_credit'
          ? `Order ${row.id} has incomplete trade-credit accounting facts`
          : `Order ${row.id} has incomplete accounting facts`,
      );
    }
    return {};
  }
  if (populated !== facts.length) {
    throw new Error(
      row.payment_method === 'trade_credit'
        ? `Order ${row.id} has incomplete trade-credit accounting facts`
        : `Order ${row.id} has incomplete accounting facts`,
    );
  }
  const {
    net_cents: netCents,
    vat_rate_basis_points: vatRate,
    vat_cents: vatCents,
    gross_cents: grossCents,
  } = row;
  if (
    !isSafeNonNegativeInteger(netCents) ||
    !isSafeNonNegativeInteger(vatRate) ||
    vatRate > 10_000 ||
    !isSafeNonNegativeInteger(vatCents) ||
    !isSafeNonNegativeInteger(grossCents) ||
    !isSafeNonNegativeInteger(row.total_cents)
  ) {
    throw new Error(`Order ${row.id} has invalid accounting facts`);
  }
  if (vatRate > 0 && netCents > Math.floor(Number.MAX_SAFE_INTEGER / vatRate)) {
    throw new Error(`Order ${row.id} has invalid accounting facts`);
  }
  const vatNumerator = netCents * vatRate;
  if (!Number.isSafeInteger(vatNumerator) || vatNumerator > Number.MAX_SAFE_INTEGER - 5_000) {
    throw new Error(`Order ${row.id} has invalid accounting facts`);
  }
  const expectedVat = Math.floor((vatNumerator + 5_000) / 10_000);
  if (
    expectedVat !== vatCents ||
    netCents > Number.MAX_SAFE_INTEGER - vatCents ||
    netCents + vatCents !== grossCents ||
    grossCents !== row.total_cents
  ) {
    throw new Error(`Order ${row.id} has invalid accounting facts`);
  }
  if (row.payment_method === 'card') {
    if (row.company_id !== null || vatRate !== 0) {
      throw new Error(`Order ${row.id} has invalid card accounting facts`);
    }
    return {
      paymentMethod: 'card',
      netCents,
      vatRateBasisPoints: vatRate,
      vatCents,
      grossCents,
    };
  }
  if (!isSafePositiveInteger(row.company_id)) {
    throw new Error(`Order ${row.id} has incomplete trade-credit accounting facts`);
  }
  return {
    paymentMethod: 'trade_credit',
    companyId: String(row.company_id),
    netCents,
    vatRateBasisPoints: vatRate,
    vatCents,
    grossCents,
  };
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function mapOrder(row: OrderRow, items: ProductLineRow[]): Order {
  const accounting = hydrateOrderAccounting(row);
  return {
    id: String(row.id),
    status: row.lifecycle_status,
    version: row.version,
    country: row.country,
    items: items.map((item): OrderLineItem => {
      const customBlend = hydrateOrderCustomBlend(item);
      return {
        lineId: String(item.id),
        productId: String(item.product_id),
        productName: item.product_name,
        unitPriceCents: item.product_price_cents,
        quantity: item.quantity,
        discountableTotalCents: item.discountable_total_cents,
        blendingFeeCents: item.blending_fee_cents,
        lineTotalCents: item.line_total_cents,
        inventoryStatus:
          (item.cancelled_quantity ?? 0) > 0
            ? 'cancelled'
            : (item.backordered_quantity ?? 0) === 0
              ? 'allocated'
              : (item.allocated_quantity ?? 0) === 0
                ? 'backordered'
                : 'partially_backordered',
        allocatedQuantity: item.allocated_quantity ?? item.quantity,
        backorderedQuantity: item.backordered_quantity ?? 0,
        variantSnapshot:
          item.variant_id != null
            ? {
                variantId: item.variant_id,
                sku: item.sku ?? '',
                label: item.variant_label ?? item.product_name,
                unitPriceCents: item.product_price_cents,
                weightGrams: item.weight_grams ?? 1000,
                consumptionClassification:
                  (item.consumption_classification as OrderLineVariantSnapshot['consumptionClassification']) ??
                  'non-food',
                deliveryClass:
                  (item.delivery_class as OrderLineVariantSnapshot['deliveryClass']) ?? 'parcel',
              }
            : undefined,
        ...(customBlend ? { customBlend } : {}),
      };
    }),
    subtotalCents: row.subtotal_cents,
    discountCents: row.discount_cents,
    totalCents: row.total_cents,
    ...accounting,
    promoApplied: row.promo_code_applied,
    promoCategoryScope: row.promo_category_scope ?? undefined,
    discountBaseCents: row.discount_base_cents ?? undefined,
    createdAt: row.created_at,
    deliveryMode: (row.delivery_mode as Order['deliveryMode']) ?? undefined,
    deliveryChargeCents: row.delivery_charge_cents ?? undefined,
    deliveryWeightGrams: row.delivery_weight_grams ?? undefined,
    deliveryAddress: hydrateOrderSnapshot<PostalAddress>(
      row.id,
      'delivery address snapshot',
      PostalAddress,
      row.delivery_address_json,
    ),
    billingEntity: hydrateOrderSnapshot<BillingEntitySnapshot>(
      row.id,
      'billing entity snapshot',
      BillingEntitySnapshot,
      row.billing_entity_json,
    ),
    deliverySlot: hydrateOrderSlot(row),
    purchaseOrderReference: row.purchase_order_reference ?? undefined,
  };
}

function mapShipment(
  row: ShipmentRow,
  lines: Array<{ line_id: number; quantity: number }>,
): OrderShipment {
  return {
    id: String(row.id),
    shipmentNumber: row.shipment_number,
    status: row.status,
    trackingReference: row.tracking_reference,
    version: row.version,
    lines: lines.map((line) => ({
      lineId: String(line.line_id),
      quantity: line.quantity,
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createOrderRepository(db: Database.Database): OrderRepository {
  const loadOrder = (orderId: number, country?: Country): OrderRow | undefined =>
    db
      .prepare(
        `SELECT id, country, promo_code_applied, promo_category_scope, subtotal_cents, discount_base_cents, discount_cents, total_cents,
            payment_method, company_id, net_cents, vat_rate_basis_points, vat_cents, gross_cents, created_at,
            lifecycle_status, version, cancelled_at, user_id,
            delivery_mode, delivery_charge_cents, delivery_weight_grams,
            delivery_site_id, delivery_address_json, billing_entity_json,
            delivery_slot_date, delivery_slot_window, purchase_order_reference
         FROM orders WHERE id = ?${country ? ' AND country = ?' : ''}`,
      )
      .get(...(country ? [orderId, country] : [orderId])) as OrderRow | undefined;
  const loadLineItems = (orderId: number) =>
    db
      .prepare(
        `SELECT line.id, line.product_id, line.product_name, line.product_price_cents,
           line.quantity, line.line_total_cents,
           line.discountable_total_cents, line.blending_fee_cents, line.custom_blend_json,
           line.variant_id, line.sku, line.variant_label, line.weight_grams,
           line.consumption_classification, line.delivery_class,
           allocation.allocated_quantity, allocation.backordered_quantity, allocation.cancelled_quantity
         FROM order_line_items line
         LEFT JOIN order_inventory_allocations allocation ON allocation.order_line_item_id = line.id
         WHERE line.order_id = ? ORDER BY line.id ASC`,
      )
      .all(orderId) as ProductLineRow[];
  const loadExportOwned = (userId: number): Order[] => {
    const rows = db
      .prepare(
        `SELECT id, country, promo_code_applied, promo_category_scope, subtotal_cents, discount_base_cents,
                discount_cents, total_cents, payment_method, company_id, net_cents,
                vat_rate_basis_points, vat_cents, gross_cents, created_at, lifecycle_status, version, cancelled_at,
                user_id, delivery_mode, delivery_charge_cents, delivery_weight_grams,
                delivery_site_id, delivery_address_json, billing_entity_json, delivery_slot_date,
                delivery_slot_window, purchase_order_reference
         FROM orders WHERE user_id = ? ORDER BY id ASC`,
      )
      .all(userId) as OrderRow[];
    if (rows.length === 0) return [];
    const lineRows = db
      .prepare(
        `SELECT line.id, line.product_id, line.product_name, line.product_price_cents,
                line.quantity, line.line_total_cents, line.discountable_total_cents,
                line.blending_fee_cents, line.custom_blend_json, line.variant_id, line.sku,
                line.variant_label, line.weight_grams, line.consumption_classification,
                line.delivery_class, allocation.allocated_quantity, allocation.backordered_quantity,
                allocation.cancelled_quantity, line.order_id
         FROM order_line_items line
         JOIN orders owned_order ON owned_order.id = line.order_id
         LEFT JOIN order_inventory_allocations allocation ON allocation.order_line_item_id = line.id
         WHERE owned_order.user_id = ?
         ORDER BY line.order_id ASC, line.id ASC`,
      )
      .all(userId) as Array<ProductLineRow & { order_id: number }>;
    const linesByOrder = new Map<number, ProductLineRow[]>();
    for (const line of lineRows) {
      const lines = linesByOrder.get(line.order_id) ?? [];
      lines.push(line);
      linesByOrder.set(line.order_id, lines);
    }
    return rows.map((row) => mapOrder(row, linesByOrder.get(row.id) ?? []));
  };
  const loadShipments = (orderId: number): ShipmentRow[] =>
    db
      .prepare(
        'SELECT id, order_id, shipment_number, status, tracking_reference, version, created_at, updated_at FROM order_shipments WHERE order_id = ? ORDER BY shipment_number ASC, id ASC',
      )
      .all(orderId) as ShipmentRow[];
  const findDetail = (orderId: number, country?: Country): OrderDetailResponse | undefined => {
    const row = loadOrder(orderId, country);
    if (!row) return undefined;
    const items = loadLineItems(orderId);
    const shipments = loadShipments(orderId);
    const shipmentLines = db
      .prepare(
        `SELECT shipment_id, order_line_item_id, quantity FROM order_shipment_items WHERE shipment_id IN (SELECT id FROM order_shipments WHERE order_id = ?) ORDER BY shipment_id ASC, order_line_item_id ASC`,
      )
      .all(orderId) as Array<{
      shipment_id: number;
      order_line_item_id: number;
      quantity: number;
    }>;
    const events = db
      .prepare(
        `SELECT id, shipment_id, event_type, tracking_code, title, detail, location, occurred_at, idempotency_key, request_fingerprint FROM order_lifecycle_events WHERE order_id = ? ORDER BY occurred_at ASC, id ASC`,
      )
      .all(orderId) as EventRow[];
    return {
      ...mapOrder(row, items),
      shipments: shipments.map((shipment) =>
        mapShipment(
          shipment,
          shipmentLines
            .filter((line) => line.shipment_id === shipment.id)
            .map((line) => ({ line_id: line.order_line_item_id, quantity: line.quantity })),
        ),
      ),
      events: events.map((event) => ({
        id: String(event.id),
        shipmentId: event.shipment_id === null ? null : String(event.shipment_id),
        type: event.event_type,
        code: event.tracking_code,
        title: event.title,
        detail: event.detail,
        location: event.location,
        occurredAt: event.occurred_at,
      })),
      canCancel:
        (row.lifecycle_status === 'processing' || row.lifecycle_status === 'packed') &&
        shipments.every((shipment) => shipment.status === 'packed'),
    };
  };
  return {
    create(params) {
      // Runtime callers compiled against the pre-country shape may still exist in deterministic
      // seed/export fixtures. The public CreateOrderParams type requires country; this compatibility
      // default keeps those historical UK rows representable while all checkout paths pass it.
      const country = params.country ?? 'UK';
      const result = db
        .prepare(
          `INSERT INTO orders
            (country, customer_name, customer_email, shipping_address, promo_code_applied, promo_category_scope,
             subtotal_cents, discount_base_cents, discount_cents, total_cents,
             delivery_mode, delivery_charge_cents, delivery_weight_grams,
             delivery_site_id, delivery_address_json, billing_entity_json,
             delivery_slot_date, delivery_slot_window, purchase_order_reference,
             user_id, created_at, lifecycle_status, version,
             payment_method, company_id, net_cents, vat_rate_basis_points, vat_cents, gross_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', 0, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          country,
          params.customerName,
          params.customerEmail,
          params.shippingAddress,
          params.promoApplied,
          params.promoCategoryScope ?? null,
          params.subtotalCents,
          params.discountBaseCents ?? null,
          params.discountCents,
          params.totalCents,
          params.deliveryMode ?? 'parcel',
          params.deliveryChargeCents ?? 0,
          params.deliveryWeightGrams ?? 0,
          params.deliverySiteId ?? null,
          params.deliveryAddress ? JSON.stringify(params.deliveryAddress) : null,
          params.billingEntity ? JSON.stringify(params.billingEntity) : null,
          params.deliverySlot?.date ?? null,
          params.deliverySlot?.window ?? null,
          params.purchaseOrderReference ?? null,
          params.userId,
          params.createdAt,
          params.paymentMethod ?? 'card',
          params.companyId ?? null,
          params.netCents ?? null,
          params.vatRateBasisPoints ?? null,
          params.vatCents ?? null,
          params.grossCents ?? null,
        );
      const orderId = Number(result.lastInsertRowid);
      const addItem = db.prepare(
        `INSERT INTO order_line_items
          (order_id, product_id, product_name, product_price_cents, quantity, line_total_cents,
           discountable_total_cents, blending_fee_cents, custom_blend_json,
           variant_id, sku, variant_label, weight_grams, consumption_classification, delivery_class)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const item of params.items)
        addItem.run(
          orderId,
          Number(item.productId),
          item.productName,
          item.unitPriceCents,
          item.quantity,
          item.lineTotalCents,
          item.discountableTotalCents,
          item.blendingFeeCents,
          item.customBlend ? JSON.stringify(item.customBlend) : null,
          item.variantSnapshot?.variantId ?? null,
          item.variantSnapshot?.sku ?? null,
          item.variantSnapshot?.label ?? null,
          item.variantSnapshot?.weightGrams ?? null,
          item.variantSnapshot?.consumptionClassification ?? null,
          item.variantSnapshot?.deliveryClass ?? null,
        );
      db.prepare(
        `INSERT INTO order_lifecycle_events (order_id, event_type, title, occurred_at) VALUES (?, 'order_created', ?, ?)`,
      ).run(orderId, orderLifecycleTitle(country, 'created'), params.createdAt);
      return orderId;
    },
    country(orderId) {
      const row = db.prepare('SELECT country FROM orders WHERE id = ?').get(orderId) as
        { country?: Country } | undefined;
      return row?.country;
    },
    findById(orderId) {
      const row = loadOrder(orderId);
      if (!row) return undefined;
      return mapOrder(row, loadLineItems(orderId));
    },
    findDetailById: findDetail,
    findOwnedDetail(orderId, userId) {
      const row = db
        .prepare('SELECT id FROM orders WHERE id = ? AND user_id = ?')
        .get(orderId, userId) as { id: number } | undefined;
      return row ? findDetail(orderId) : undefined;
    },
    listOwned(userId, page, pageSize) {
      const offset = (page - 1) * pageSize;
      const items = db
        .prepare(
          `SELECT o.id, o.country, o.lifecycle_status, o.version, o.total_cents,
          o.payment_method, o.company_id, o.net_cents, o.vat_rate_basis_points, o.vat_cents,
          o.gross_cents, o.created_at,
          o.purchase_order_reference,
          COALESCE((SELECT SUM(quantity) FROM order_line_items WHERE order_id = o.id), 0) AS total_items,
          EXISTS(SELECT 1 FROM order_inventory_allocations allocation
            JOIN order_line_items line ON line.id = allocation.order_line_item_id
            WHERE line.order_id = o.id AND allocation.backordered_quantity > 0) AS has_backorder
        FROM orders o WHERE o.user_id = ? ORDER BY o.created_at DESC, o.id DESC LIMIT ? OFFSET ?`,
        )
        .all(userId, pageSize, offset) as Array<{
        id: number;
        country: Country;
        lifecycle_status: OrderStatus;
        version: number;
        total_cents: number;
        payment_method: 'card' | 'trade_credit';
        company_id: number | null;
        net_cents: number | null;
        vat_rate_basis_points: number | null;
        vat_cents: number | null;
        gross_cents: number | null;
        total_items: number;
        has_backorder: number;
        created_at: string;
        purchase_order_reference: string | null;
      }>;
      const count = db
        .prepare('SELECT COUNT(*) AS count FROM orders WHERE user_id = ?')
        .get(userId) as { count: number };
      return {
        items: items.map((row) => {
          const accounting = hydrateOrderAccounting(row);
          return {
            id: String(row.id),
            status: row.lifecycle_status,
            version: row.version,
            country: row.country,
            totalCents: row.total_cents,
            ...accounting,
            totalItems: row.total_items,
            hasBackorder: row.has_backorder === 1,
            createdAt: row.created_at,
            // Contract-optional: absent on every order placed before checkout captured a reference.
            purchaseOrderReference: row.purchase_order_reference ?? undefined,
          };
        }),
        total: count.count,
      };
    },
    listExportOwned: loadExportOwned,
    getOrderState(orderId) {
      const row = loadOrder(orderId);
      return (
        row && {
          id: row.id,
          status: row.lifecycle_status,
          version: row.version,
          cancelledAt: row.cancelled_at,
        }
      );
    },
    getShipment(shipmentId) {
      const row = db
        .prepare(
          'SELECT id, order_id, shipment_number, status, tracking_reference, version, created_at, updated_at FROM order_shipments WHERE id = ?',
        )
        .get(shipmentId) as ShipmentRow | undefined;
      return (
        row && {
          id: row.id,
          orderId: row.order_id,
          shipmentNumber: row.shipment_number,
          status: row.status,
          trackingReference: row.tracking_reference,
          version: row.version,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }
      );
    },
    listShipments(orderId) {
      return loadShipments(orderId).map((row) => ({
        id: row.id,
        orderId: row.order_id,
        shipmentNumber: row.shipment_number,
        status: row.status,
        trackingReference: row.tracking_reference,
        version: row.version,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    },
    listAllocatableLines(orderId) {
      return (
        db
          .prepare(
            `SELECT line.id, COALESCE(allocation.allocated_quantity, line.quantity) AS quantity
           FROM order_line_items line
           LEFT JOIN order_inventory_allocations allocation ON allocation.order_line_item_id = line.id
           WHERE line.order_id = ? ORDER BY line.id`,
          )
          .all(orderId) as Array<{ id: number; quantity: number }>
      ).map((line) => ({ lineId: String(line.id), quantity: line.quantity }));
    },
    hasOutstandingBackorder(orderId) {
      return !!db
        .prepare(
          `SELECT 1 FROM order_inventory_allocations allocation
           JOIN order_line_items line ON line.id = allocation.order_line_item_id
           WHERE line.order_id = ? AND allocation.backordered_quantity > 0 LIMIT 1`,
        )
        .get(orderId);
    },
    insertShipment({ orderId, shipmentNumber, trackingReference, createdAt }) {
      return Number(
        db
          .prepare(
            `INSERT INTO order_shipments (order_id, shipment_number, status, tracking_reference, version, created_at, updated_at) VALUES (?, ?, 'packed', ?, 0, ?, ?)`,
          )
          .run(orderId, shipmentNumber, trackingReference, createdAt, createdAt).lastInsertRowid,
      );
    },
    insertShipmentLine({ shipmentId, lineId, quantity }) {
      db.prepare(
        'INSERT INTO order_shipment_items (shipment_id, order_line_item_id, quantity) VALUES (?, ?, ?)',
      ).run(shipmentId, lineId, quantity);
    },
    updateShipmentStatus({ shipmentId, expectedVersion, status, updatedAt }) {
      return (
        db
          .prepare(
            'UPDATE order_shipments SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?',
          )
          .run(status, updatedAt, shipmentId, expectedVersion).changes === 1
      );
    },
    touchShipment({ shipmentId, expectedVersion, updatedAt }) {
      return (
        db
          .prepare(
            'UPDATE order_shipments SET version = version + 1, updated_at = ? WHERE id = ? AND version = ?',
          )
          .run(updatedAt, shipmentId, expectedVersion).changes === 1
      );
    },
    updateOrderStatus({ orderId, expectedVersion, status, cancelledAt = null }) {
      return (
        db
          .prepare(
            'UPDATE orders SET lifecycle_status = ?, cancelled_at = ?, version = version + 1 WHERE id = ? AND version = ?',
          )
          .run(status, cancelledAt, orderId, expectedVersion).changes === 1
      );
    },
    cancelPackedShipments(orderId, updatedAt) {
      db.prepare(
        "UPDATE order_shipments SET status = 'cancelled', version = version + 1, updated_at = ? WHERE order_id = ? AND status = 'packed'",
      ).run(updatedAt, orderId);
    },
    insertEvent(input) {
      return Number(
        db
          .prepare(
            'INSERT INTO order_lifecycle_events (order_id, shipment_id, event_type, tracking_code, title, detail, location, idempotency_key, request_fingerprint, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            input.orderId,
            input.shipmentId ?? null,
            input.type,
            input.code ?? null,
            input.title,
            input.detail ?? null,
            input.location ?? null,
            input.idempotencyKey ?? null,
            input.requestFingerprint ?? null,
            input.occurredAt,
          ).lastInsertRowid,
      );
    },
    findEventByIdempotencyKey(key) {
      const row = db
        .prepare(
          'SELECT order_id, request_fingerprint FROM order_lifecycle_events WHERE idempotency_key = ?',
        )
        .get(key) as { order_id: number; request_fingerprint: string } | undefined;
      return row && { orderId: row.order_id, requestFingerprint: row.request_fingerprint };
    },
    replaceAccessGrant({ orderId, tokenDigest, expiresAt, createdAt }) {
      db.prepare('DELETE FROM order_access_grants WHERE order_id = ?').run(orderId);
      db.prepare(
        'INSERT INTO order_access_grants (order_id, token_digest, expires_at, created_at) VALUES (?, ?, ?, ?)',
      ).run(orderId, tokenDigest, expiresAt, createdAt);
    },
    hasValidAccessGrant(orderId, tokenDigest, now) {
      return Boolean(
        db
          .prepare(
            'SELECT 1 FROM order_access_grants WHERE order_id = ? AND token_digest = ? AND expires_at > ?',
          )
          .get(orderId, tokenDigest, now),
      );
    },
  };
}
