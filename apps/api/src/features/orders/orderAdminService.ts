import type { OrderStatus } from '@shop/contracts/orders';
import type { Country } from '@shop/contracts/country';
import type { AdminOrderDetailResponse } from '@shop/contracts/admin-orders-list';
import type { OrderRepository } from './orderRepository.js';
import type {
  AdminOrderListItem,
  AdminOrderListQuery,
  OrderAdminRepository,
} from './orderAdminRepository.js';

export class OrderAdminError extends Error {
  constructor(readonly code: 'INVALID_QUERY' | 'ORDER_NOT_FOUND') {
    super(code);
    this.name = 'OrderAdminError';
  }
}

export interface OrderAdminService {
  listAdmin(
    query: Partial<AdminOrderListQuery>,
    country?: Country,
  ): {
    items: AdminOrderListItem[];
    total: number;
    page: number;
    pageSize: number;
  };
  getAdminDetail(orderId: number, country?: Country): AdminOrderDetailResponse;
}

const statuses = new Set<OrderStatus>([
  'processing',
  'packed',
  'shipped',
  'delivered',
  'delivery_failed',
  'cancelled',
]);

function page(value: number | undefined, name: 'page' | 'pageSize'): number {
  const fallback = name === 'page' ? 1 : 25;
  const result = value ?? fallback;
  const maximum = name === 'page' ? 10_000 : 100;
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) {
    throw new OrderAdminError('INVALID_QUERY');
  }
  return result;
}

function optionalText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) throw new OrderAdminError('INVALID_QUERY');
  return normalized;
}

function optionalIso(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (Number.isNaN(Date.parse(value))) throw new OrderAdminError('INVALID_QUERY');
  return value;
}

export function createOrderAdminService(deps: {
  repository: OrderAdminRepository;
  orderRepository: Pick<OrderRepository, 'findDetailById'>;
}): OrderAdminService {
  return {
    listAdmin(input, country) {
      const status = input.status;
      if (status !== undefined && !statuses.has(status)) throw new OrderAdminError('INVALID_QUERY');
      const occurredFrom = optionalIso(input.occurredFrom);
      const occurredTo = optionalIso(input.occurredTo);
      if (occurredFrom && occurredTo && occurredFrom > occurredTo) {
        throw new OrderAdminError('INVALID_QUERY');
      }
      const query: AdminOrderListQuery = {
        status,
        userEmail: optionalText(input.userEmail),
        promoCode: optionalText(input.promoCode),
        occurredFrom,
        occurredTo,
        page: page(input.page, 'page'),
        pageSize: page(input.pageSize, 'pageSize'),
        country,
      };
      const result = deps.repository.list(query);
      return { ...result, page: query.page, pageSize: query.pageSize };
    },
    getAdminDetail(orderId, country) {
      if (!Number.isSafeInteger(orderId) || orderId < 1)
        throw new OrderAdminError('ORDER_NOT_FOUND');
      const order = deps.orderRepository.findDetailById(orderId, country);
      if (!order) throw new OrderAdminError('ORDER_NOT_FOUND');
      // Credit orders expose their frozen invoice/accounting tuple on the order detail, but are
      // never card-refund candidates. Undefined remains the historical/card-compatible branch.
      const refundPayment =
        order.paymentMethod === 'trade_credit' ? null : deps.repository.findRefundPayment(orderId);
      return { ...order, refundPayment };
    },
  };
}
