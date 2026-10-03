import type { OrderStatus, ShipmentStatus } from '@shop/contracts/orders';
import { createHash } from 'node:crypto';
import { OrderDomainError } from './orderErrors.js';

export interface AllocatedLine {
  lineId: string;
  quantity: number;
}

export interface AllocationShipment {
  lines: AllocatedLine[];
}

export function aggregateOrderStatus(
  shipments: readonly { status: ShipmentStatus }[],
): OrderStatus {
  if (shipments.some((shipment) => shipment.status === 'cancelled')) return 'cancelled';
  if (shipments.some((shipment) => shipment.status === 'delivery_failed')) return 'delivery_failed';
  if (shipments.length > 0 && shipments.every((shipment) => shipment.status === 'delivered')) {
    return 'delivered';
  }
  if (
    shipments.some((shipment) => shipment.status === 'shipped' || shipment.status === 'delivered')
  ) {
    return 'shipped';
  }
  if (shipments.length > 0) return 'packed';
  return 'processing';
}

/** Requires each persisted purchased line to be allocated exactly once across the complete plan. */
export function assertCompleteAllocation(
  orderedLines: readonly AllocatedLine[],
  shipments: readonly AllocationShipment[],
): void {
  if (shipments.length === 0) throw new OrderDomainError('INVALID_ALLOCATION');
  const ordered = new Map<string, number>();
  for (const line of orderedLines) {
    const key = line.lineId;
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0 || ordered.has(key)) {
      throw new OrderDomainError('INVALID_ALLOCATION');
    }
    ordered.set(key, line.quantity);
  }
  const allocated = new Map<string, number>();
  for (const shipment of shipments) {
    if (shipment.lines.length === 0) throw new OrderDomainError('INVALID_ALLOCATION');
    const inShipment = new Set<string>();
    for (const line of shipment.lines) {
      const key = line.lineId;
      if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0 || !ordered.has(key)) {
        throw new OrderDomainError('INVALID_ALLOCATION');
      }
      if (inShipment.has(key)) throw new OrderDomainError('INVALID_ALLOCATION');
      inShipment.add(key);
      allocated.set(key, (allocated.get(key) ?? 0) + line.quantity);
    }
  }
  for (const [lineId, quantity] of ordered) {
    if (allocated.get(lineId) !== quantity) throw new OrderDomainError('INVALID_ALLOCATION');
  }
}

export function assertShipmentTransition(from: ShipmentStatus, to: ShipmentStatus): void {
  const allowed =
    (from === 'packed' && to === 'shipped') ||
    (from === 'shipped' && (to === 'delivered' || to === 'delivery_failed'));
  if (!allowed) throw new OrderDomainError('INVALID_TRANSITION');
}

export function assertCanCancel(
  status: OrderStatus,
  shipments: readonly { status: ShipmentStatus }[],
): void {
  if (
    (status !== 'processing' && status !== 'packed') ||
    shipments.some((shipment) => shipment.status !== 'packed')
  ) {
    throw new OrderDomainError('CANCELLATION_NOT_ALLOWED');
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

/** Stable SHA-256 request identity: operation plus recursively key-sorted payload. */
export function lifecycleFingerprint(operation: string, payload: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize({ operation, payload })))
    .digest('hex');
}
