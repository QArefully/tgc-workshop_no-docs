import type {
  OrderDetailResponse,
  OrderListResponse,
  ShipmentStatus,
} from '@shop/contracts/orders';
import type { Country } from '@shop/contracts/country';
import { orderLifecycleTitle } from '@shop/localisation/messages/asyncContent';
import type { UnitOfWork } from '../../db/unitOfWork.js';
import type { AuditContext } from '../audit/auditEvent.js';
import type { AuditWriter } from '../audit/auditService.js';
import type { Clock } from '../auth/authService.js';
import type { InvoiceService } from '../invoices/invoiceService.js';
import type { InvoiceRepository } from '../invoices/invoiceRepository.js';
import { InvoiceDomainError } from '../invoices/invoiceErrors.js';
import { OrderDomainError } from './orderErrors.js';
import {
  aggregateOrderStatus,
  assertCanCancel,
  assertCompleteAllocation,
  assertShipmentTransition,
  lifecycleFingerprint,
} from './orderLifecycle.js';
import type { OrderRepository } from './orderRepository.js';
import type { ShipmentAllocation } from './orderTypes.js';
import type { InventoryService } from '../inventory/inventoryService.js';

export interface OrderService {
  get(orderId: number): OrderDetailResponse | undefined;
  getOwned(orderId: number, userId: number): OrderDetailResponse | undefined;
  listOwned(userId: number, page?: number, pageSize?: number): OrderListResponse;
  pack(input: {
    orderId: number;
    version: number;
    idempotencyKey: string;
    shipments: ShipmentAllocation[];
    context: AuditContext;
  }): OrderDetailResponse;
  transitionShipment(input: {
    shipmentId: number;
    version: number;
    status: Extract<ShipmentStatus, 'shipped' | 'delivered' | 'delivery_failed'>;
    idempotencyKey: string;
    context: AuditContext;
  }): OrderDetailResponse;
  addTrackingEvent(input: {
    shipmentId: number;
    version: number;
    code: 'in_transit' | 'out_for_delivery' | 'delivery_attempted' | 'delivered';
    title: string;
    detail?: string;
    location?: string;
    idempotencyKey: string;
    context: AuditContext;
  }): OrderDetailResponse;
  cancel(input: {
    orderId: number;
    version: number;
    idempotencyKey: string;
    context: AuditContext;
  }): OrderDetailResponse;
}

function titleForStatus(status: ShipmentStatus, country: Country): string {
  return status === 'shipped'
    ? orderLifecycleTitle(country, 'shipmentShipped')
    : status === 'delivered'
      ? orderLifecycleTitle(country, 'shipmentDelivered')
      : orderLifecycleTitle(country, 'shipmentDeliveryFailed');
}

type OrderServiceDependencies = {
  repository: OrderRepository;
  unitOfWork?: UnitOfWork;
  clock?: Clock;
  audit?: AuditWriter;
  inventory?: Pick<InventoryService, 'cancelOrderInventory'>;
  /** Invoice and payment readers used to validate credit-order cancellation identity. */
  invoiceRepository?: Pick<
    InvoiceRepository,
    'findByOrderId' | 'findByPaymentIdempotencyKey' | 'findPaymentForIssue'
  >;
  /** Canonical invoice lifecycle command used by credit-order cancellation. */
  invoices?: Pick<InvoiceService, 'void'>;
  /** Compatibility alias for composition roots that use the service name. */
  invoiceService?: Pick<InvoiceService, 'void'>;
};

function isBusySnapshot(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'SQLITE_BUSY_SNAPSHOT'
  );
}

type CancellationOrder = NonNullable<ReturnType<OrderRepository['findById']>>;
type CancellationInvoiceRepository = NonNullable<OrderServiceDependencies['invoiceRepository']>;

function cancellationLinkageMismatch(): never {
  throw new InvoiceDomainError('INVOICE_TOTAL_MISMATCH');
}

function validateCancellationOrderAccounting(order: CancellationOrder): void {
  if (
    order.paymentMethod !== undefined &&
    order.paymentMethod !== 'card' &&
    order.paymentMethod !== 'trade_credit'
  ) {
    cancellationLinkageMismatch();
  }

  const accounting = [order.netCents, order.vatRateBasisPoints, order.vatCents, order.grossCents];
  const populated = accounting.filter((fact) => fact !== undefined).length;
  if (populated !== 0 && populated !== accounting.length) cancellationLinkageMismatch();

  if (order.paymentMethod === undefined) {
    if (order.companyId !== undefined || populated !== 0) cancellationLinkageMismatch();
    return;
  }
  if (order.paymentMethod === 'card') {
    if (order.companyId !== undefined) cancellationLinkageMismatch();
    return;
  }
  if (order.companyId === undefined || populated !== accounting.length) {
    cancellationLinkageMismatch();
  }
}

function readCancellationInvoice(
  repository: CancellationInvoiceRepository,
  order: CancellationOrder,
  occurredAt: string,
): ReturnType<InvoiceRepository['findByOrderId']> {
  let invoice: ReturnType<InvoiceRepository['findByOrderId']>;
  try {
    invoice = repository.findByOrderId(Number(order.id), occurredAt);
  } catch (error) {
    if (error instanceof InvoiceDomainError) throw error;
    cancellationLinkageMismatch();
  }

  if (order.paymentMethod !== 'trade_credit') {
    // Card and historical orders must never acquire an invoice as a side effect of a lookup.
    if (invoice) cancellationLinkageMismatch();
    return undefined;
  }
  if (!invoice) cancellationLinkageMismatch();

  if (
    invoice.orderId !== String(order.id) ||
    invoice.paymentMethod !== 'trade_credit' ||
    invoice.country !== order.country ||
    invoice.companyId !== order.companyId ||
    invoice.netCents !== order.netCents ||
    invoice.vatRateBasisPoints !== order.vatRateBasisPoints ||
    invoice.vatCents !== order.vatCents ||
    invoice.grossCents !== order.grossCents
  ) {
    cancellationLinkageMismatch();
  }

  const paymentIdempotencyKey = invoice.paymentIdempotencyKey;
  if (typeof paymentIdempotencyKey !== 'string' || paymentIdempotencyKey.length === 0) {
    cancellationLinkageMismatch();
  }

  let byPayment: ReturnType<InvoiceRepository['findByPaymentIdempotencyKey']>;
  let payment: ReturnType<NonNullable<InvoiceRepository['findPaymentForIssue']>> | undefined;
  try {
    byPayment = repository.findByPaymentIdempotencyKey(paymentIdempotencyKey, occurredAt);
    payment = repository.findPaymentForIssue?.(paymentIdempotencyKey);
  } catch (error) {
    if (error instanceof InvoiceDomainError) throw error;
    cancellationLinkageMismatch();
  }
  if (!byPayment || byPayment.id !== invoice.id || byPayment.orderId !== invoice.orderId) {
    cancellationLinkageMismatch();
  }

  const companyId = Number(order.companyId);
  if (
    !payment ||
    payment.idempotencyKey !== paymentIdempotencyKey ||
    payment.orderId !== Number(order.id) ||
    payment.paymentMethod !== 'trade_credit' ||
    payment.companyId !== companyId ||
    payment.amountCents !== order.grossCents
  ) {
    cancellationLinkageMismatch();
  }
  return invoice;
}

/** Accepts legacy repository-only construction for pre-P3 read routes. Mutation commands require UoW + audit. */
export function createOrderService(
  dependenciesOrRepository: OrderServiceDependencies | OrderRepository,
): OrderService {
  const dependencies: OrderServiceDependencies =
    'repository' in dependenciesOrRepository
      ? dependenciesOrRepository
      : { repository: dependenciesOrRepository };
  const clock = dependencies.clock ?? { now: () => new Date() };
  const requireMutationDependencies = (): { unitOfWork: UnitOfWork; audit: AuditWriter } => {
    if (!dependencies.unitOfWork || !dependencies.audit) {
      throw new Error('Order lifecycle mutations require unitOfWork and audit dependencies');
    }
    return { unitOfWork: dependencies.unitOfWork, audit: dependencies.audit };
  };
  const run = <T>(work: () => T): T => requireMutationDependencies().unitOfWork.run(work);
  const detail = (orderId: number) => {
    const order = dependencies.repository.findDetailById(orderId);
    if (!order) throw new OrderDomainError('ORDER_NOT_FOUND');
    return order;
  };
  const replayOrConflict = (key: string, fingerprint: string): OrderDetailResponse | undefined => {
    const previous = dependencies.repository.findEventByIdempotencyKey(key);
    if (!previous) return undefined;
    if (previous.requestFingerprint !== fingerprint)
      throw new OrderDomainError('IDEMPOTENCY_CONFLICT');
    return detail(previous.orderId);
  };
  const append = (input: Parameters<AuditWriter['append']>[0]) =>
    requireMutationDependencies().audit.append(input);
  return {
    get: (orderId) => dependencies.repository.findDetailById(orderId),
    getOwned: (orderId, userId) => dependencies.repository.findOwnedDetail(orderId, userId),
    listOwned(userId, page = 1, pageSize = 20) {
      const result = dependencies.repository.listOwned(userId, page, pageSize);
      return { ...result, page, pageSize };
    },
    pack(input) {
      const fingerprint = lifecycleFingerprint('pack', {
        orderId: input.orderId,
        version: input.version,
        shipments: input.shipments,
      });
      return run(() => {
        const replay = replayOrConflict(input.idempotencyKey, fingerprint);
        if (replay) return replay;
        const state = dependencies.repository.getOrderState(input.orderId);
        if (!state) throw new OrderDomainError('ORDER_NOT_FOUND');
        if (state.version !== input.version || state.status !== 'processing')
          throw new OrderDomainError('STALE_VERSION');
        if (dependencies.repository.hasOutstandingBackorder(input.orderId)) {
          throw new OrderDomainError('OUTSTANDING_BACKORDER');
        }
        const lines = dependencies.repository.listAllocatableLines(input.orderId);
        assertCompleteAllocation(lines, input.shipments);
        const occurredAt = clock.now().toISOString();
        const country = dependencies.repository.country(input.orderId);
        if (!country) throw new OrderDomainError('ORDER_NOT_FOUND');
        input.shipments.forEach((shipment, index) => {
          const shipmentId = dependencies.repository.insertShipment({
            orderId: input.orderId,
            shipmentNumber: index + 1,
            trackingReference: shipment.trackingReference ?? null,
            createdAt: occurredAt,
          });
          shipment.lines.forEach((line) => {
            const found = lines.find((candidate) => candidate.lineId === line.lineId);
            if (!found) throw new OrderDomainError('INVALID_ALLOCATION');
            dependencies.repository.insertShipmentLine({
              shipmentId,
              lineId: Number(line.lineId),
              quantity: line.quantity,
            });
          });
          dependencies.repository.insertEvent({
            orderId: input.orderId,
            shipmentId,
            type: 'shipment_packed',
            title: orderLifecycleTitle(country, 'shipmentPacked'),
            idempotencyKey: index === 0 ? input.idempotencyKey : undefined,
            requestFingerprint: index === 0 ? fingerprint : undefined,
            occurredAt,
          });
        });
        if (
          !dependencies.repository.updateOrderStatus({
            orderId: input.orderId,
            expectedVersion: state.version,
            status: 'packed',
          })
        )
          throw new OrderDomainError('STALE_VERSION');
        append({
          action: 'order.shipment_packed',
          context: input.context,
          orderId: input.orderId,
          shipmentCount: input.shipments.length,
        });
        return detail(input.orderId);
      });
    },
    transitionShipment(input) {
      const fingerprint = lifecycleFingerprint('transition', {
        shipmentId: input.shipmentId,
        version: input.version,
        status: input.status,
      });
      return run(() => {
        const replay = replayOrConflict(input.idempotencyKey, fingerprint);
        if (replay) return replay;
        const shipment = dependencies.repository.getShipment(input.shipmentId);
        if (!shipment) throw new OrderDomainError('ORDER_NOT_FOUND');
        if (shipment.version !== input.version) throw new OrderDomainError('STALE_VERSION');
        assertShipmentTransition(shipment.status, input.status);
        const state = dependencies.repository.getOrderState(shipment.orderId);
        if (!state) throw new OrderDomainError('ORDER_NOT_FOUND');
        const occurredAt = clock.now().toISOString();
        const country = dependencies.repository.country(shipment.orderId);
        if (!country) throw new OrderDomainError('ORDER_NOT_FOUND');
        if (
          !dependencies.repository.updateShipmentStatus({
            shipmentId: shipment.id,
            expectedVersion: shipment.version,
            status: input.status,
            updatedAt: occurredAt,
          })
        )
          throw new OrderDomainError('STALE_VERSION');
        const status = aggregateOrderStatus(
          dependencies.repository.listShipments(shipment.orderId),
        );
        if (
          !dependencies.repository.updateOrderStatus({
            orderId: shipment.orderId,
            expectedVersion: state.version,
            status,
          })
        )
          throw new OrderDomainError('STALE_VERSION');
        dependencies.repository.insertEvent({
          orderId: shipment.orderId,
          shipmentId: shipment.id,
          type:
            input.status === 'shipped'
              ? 'shipment_shipped'
              : input.status === 'delivered'
                ? 'shipment_delivered'
                : 'shipment_delivery_failed',
          title: titleForStatus(input.status, country),
          idempotencyKey: input.idempotencyKey,
          requestFingerprint: fingerprint,
          occurredAt,
        });
        append({
          action: 'shipment.transitioned',
          context: input.context,
          shipmentId: shipment.id,
          orderId: shipment.orderId,
          status: input.status,
        });
        return detail(shipment.orderId);
      });
    },
    addTrackingEvent(input) {
      const fingerprint = lifecycleFingerprint('tracking', {
        shipmentId: input.shipmentId,
        version: input.version,
        code: input.code,
        title: input.title,
        detail: input.detail ?? null,
        location: input.location ?? null,
      });
      return run(() => {
        const replay = replayOrConflict(input.idempotencyKey, fingerprint);
        if (replay) return replay;
        const shipment = dependencies.repository.getShipment(input.shipmentId);
        if (!shipment) throw new OrderDomainError('ORDER_NOT_FOUND');
        if (shipment.version !== input.version) throw new OrderDomainError('STALE_VERSION');
        if (shipment.status !== 'shipped') throw new OrderDomainError('TRACKING_NOT_ALLOWED');
        const occurredAt = clock.now().toISOString();
        if (
          !dependencies.repository.touchShipment({
            shipmentId: shipment.id,
            expectedVersion: shipment.version,
            updatedAt: occurredAt,
          })
        ) {
          throw new OrderDomainError('STALE_VERSION');
        }
        dependencies.repository.insertEvent({
          orderId: shipment.orderId,
          shipmentId: shipment.id,
          type: 'shipment_tracking_updated',
          code: input.code,
          title: input.title,
          detail: input.detail,
          location: input.location,
          idempotencyKey: input.idempotencyKey,
          requestFingerprint: fingerprint,
          occurredAt,
        });
        append({
          action: 'shipment.tracking_updated',
          context: input.context,
          shipmentId: shipment.id,
          orderId: shipment.orderId,
        });
        return detail(shipment.orderId);
      });
    },
    cancel(input) {
      const fingerprint = lifecycleFingerprint('cancel', {
        orderId: input.orderId,
        version: input.version,
      });
      const work = () =>
        run(() => {
          const replay = replayOrConflict(input.idempotencyKey, fingerprint);
          if (replay) return replay;
          const state = dependencies.repository.getOrderState(input.orderId);
          if (!state) throw new OrderDomainError('ORDER_NOT_FOUND');
          if (state.version !== input.version) throw new OrderDomainError('STALE_VERSION');
          assertCanCancel(state.status, dependencies.repository.listShipments(input.orderId));
          const occurredAt = clock.now().toISOString();
          const country = dependencies.repository.country(input.orderId);
          if (!country) throw new OrderDomainError('ORDER_NOT_FOUND');

          let order: CancellationOrder | undefined;
          try {
            order = dependencies.repository.findById(input.orderId);
          } catch {
            cancellationLinkageMismatch();
          }
          if (!order) throw new OrderDomainError('ORDER_NOT_FOUND');
          validateCancellationOrderAccounting(order);

          // Resolve and validate the immutable invoice/payment identity before touching inventory,
          // shipment, exposure, or order state. The invoice command owns its lifecycle CAS and
          // exposure release; its nested UoW is part of this outer transaction.
          const invoice = dependencies.invoiceRepository
            ? readCancellationInvoice(dependencies.invoiceRepository, order, occurredAt)
            : order.paymentMethod === 'trade_credit'
              ? cancellationLinkageMismatch()
              : undefined;
          if (invoice) {
            const invoiceService = dependencies.invoices ?? dependencies.invoiceService;
            if (!invoiceService) {
              cancellationLinkageMismatch();
            }
            const standingCountry = input.context.standingCountry ?? country;
            const invoiceContext =
              input.context.standingCountry === undefined
                ? { ...input.context, standingCountry }
                : input.context;
            invoiceService.void({
              invoiceId: Number(invoice.id),
              expectedVersion: invoice.lifecycleVersion,
              idempotencyKey: input.idempotencyKey,
              reason: 'Order cancellation',
              context: invoiceContext,
              standingCountry,
              actorUserId: input.context.actor.userId,
            });
          }
          dependencies.inventory?.cancelOrderInventory({ orderId: input.orderId, occurredAt });
          dependencies.repository.cancelPackedShipments(input.orderId, occurredAt);
          if (
            !dependencies.repository.updateOrderStatus({
              orderId: input.orderId,
              expectedVersion: state.version,
              status: 'cancelled',
              cancelledAt: occurredAt,
            })
          )
            throw new OrderDomainError('STALE_VERSION');
          dependencies.repository.insertEvent({
            orderId: input.orderId,
            type: 'order_cancelled',
            title: orderLifecycleTitle(country, 'cancelled'),
            idempotencyKey: input.idempotencyKey,
            requestFingerprint: fingerprint,
            occurredAt,
          });
          append({ action: 'order.cancelled', context: input.context, orderId: input.orderId });
          return detail(input.orderId);
        });
      // The invoice reader runs before the nested invoice void command needs a writer lock. If a
      // concurrent settlement commits in that gap, SQLite rejects upgrading this transaction's
      // old read snapshot. Roll back and retry the complete cancellation from a fresh snapshot;
      // the invoice lifecycle CAS then deterministically reports either the paid winner or the
      // cancellation winner.
      for (let attempt = 0; ; attempt += 1) {
        try {
          return work();
        } catch (error) {
          if (attempt === 0 && isBusySnapshot(error)) continue;
          throw error;
        }
      }
    },
  };
}
