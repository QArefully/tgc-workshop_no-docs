import type Database from 'better-sqlite3';
import type { OrderStatus } from '@shop/contracts/orders';
import type { Country } from '@shop/contracts/country';

export interface AdminOrderListQuery {
  status?: OrderStatus;
  userEmail?: string;
  promoCode?: string;
  occurredFrom?: string;
  occurredTo?: string;
  page: number;
  pageSize: number;
  /** Standing admin country; omitted only by legacy in-process callers. */
  country?: Country;
}

export interface AdminOrderListItem {
  id: string;
  status: OrderStatus;
  version: number;
  totalCents: number;
  totalItems: number;
  hasBackorder: boolean;
  createdAt: string;
  promoCode: string | null;
  buyer: { id: string | null; email: string; name: string };
}

export interface AdminOrderRefundPayment {
  paymentId: string;
  remainingRefundableCents: number;
}

export interface OrderAdminRepository {
  list(query: AdminOrderListQuery): { items: AdminOrderListItem[]; total: number };
  findRefundPayment(orderId: number): AdminOrderRefundPayment | null;
}

const orderStatuses = new Set<OrderStatus>([
  'processing',
  'packed',
  'shipped',
  'delivered',
  'delivery_failed',
  'cancelled',
]);

/** Cross-buyer reporting query. Filter columns and ordering remain static SQL. */
export function createOrderAdminRepository(db: Database.Database): OrderAdminRepository {
  return {
    list(query) {
      const where: string[] = [];
      const params: unknown[] = [];
      if (query.status && orderStatuses.has(query.status)) {
        where.push('o.lifecycle_status = ?');
        params.push(query.status);
      }
      if (query.userEmail) {
        where.push('LOWER(COALESCE(u.email, o.customer_email)) = LOWER(?)');
        params.push(query.userEmail);
      }
      if (query.promoCode) {
        where.push('o.promo_code_applied = ?');
        params.push(query.promoCode);
      }
      if (query.occurredFrom) {
        where.push('o.created_at >= ?');
        params.push(query.occurredFrom);
      }
      if (query.occurredTo) {
        where.push('o.created_at <= ?');
        params.push(query.occurredTo);
      }
      if (query.country) {
        where.push('o.country = ?');
        params.push(query.country);
      }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const offset = (query.page - 1) * query.pageSize;
      const count = db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM orders o LEFT JOIN users u ON u.id = o.user_id ${clause}`,
        )
        .get(...params) as { count: number };
      const rows = db
        .prepare(
          `SELECT o.id, o.lifecycle_status, o.version, o.total_cents, o.created_at,
                  o.promo_code_applied, o.customer_name, o.customer_email, o.user_id,
                  u.email AS user_email,
                  COALESCE((SELECT SUM(quantity) FROM order_line_items WHERE order_id = o.id), 0)
                    AS total_items,
                  EXISTS(SELECT 1 FROM order_inventory_allocations allocation
                    JOIN order_line_items line ON line.id = allocation.order_line_item_id
                    WHERE line.order_id = o.id AND allocation.backordered_quantity > 0) AS has_backorder
           FROM orders o LEFT JOIN users u ON u.id = o.user_id
           ${clause}
           ORDER BY o.created_at DESC, o.id DESC
           LIMIT ? OFFSET ?`,
        )
        .all(...params, query.pageSize, offset) as Array<{
        id: number;
        lifecycle_status: OrderStatus;
        version: number;
        total_cents: number;
        created_at: string;
        promo_code_applied: string | null;
        customer_name: string;
        customer_email: string;
        user_id: number | null;
        user_email: string | null;
        total_items: number;
        has_backorder: number;
      }>;
      return {
        items: rows.map((row) => ({
          id: String(row.id),
          status: row.lifecycle_status,
          version: row.version,
          totalCents: row.total_cents,
          totalItems: row.total_items,
          hasBackorder: row.has_backorder === 1,
          createdAt: row.created_at,
          promoCode: row.promo_code_applied,
          buyer: {
            id: row.user_id === null ? null : String(row.user_id),
            email: row.user_email ?? row.customer_email,
            name: row.customer_name,
          },
        })),
        total: count.count,
      };
    },
    findRefundPayment(orderId) {
      const row = db
        .prepare(
          `SELECT p.id AS payment_id,
                  p.amount_cents -
                    COALESCE((SELECT SUM(net_refund_cents) FROM refunds WHERE payment_id = p.id), 0) -
                    COALESCE((SELECT SUM(amount_cents) FROM admin_refunds WHERE payment_id = p.id), 0)
                    AS remaining_refundable_cents
           FROM payments p
           WHERE p.order_id = ? AND p.status = 'succeeded' AND p.payment_method = 'card'
           ORDER BY p.created_at DESC, p.id DESC
           LIMIT 1`,
        )
        .get(orderId) as { payment_id: number; remaining_refundable_cents: number } | undefined;
      return row
        ? {
            paymentId: String(row.payment_id),
            remainingRefundableCents: row.remaining_refundable_cents,
          }
        : null;
    },
  };
}
