import { FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { sendPublicError } from '../utils/errors.js';
import {
  CancelOrderBody,
  OrderDetailResponse,
  OrderIdParam,
  OrderListQuery,
  OrderListResponse,
} from '@shop/contracts/orders';
import { InvoiceDetailResponse, type Invoice } from '@shop/contracts/trade-credit';
import { ErrorResponse } from '@shop/contracts/common';
import type { AppServices } from '../app.js';
import { InvoiceDomainError } from '../features/invoices/invoiceErrors.js';
import { OrderDomainError } from '../features/orders/orderErrors.js';
import { requireCustomer } from '../plugins/auth.js';

// Invoice integrity callbacks are enforced by the invoice service/repository. Fastify's
// serializer cannot merge the callback `allOf` branches, so flatten the plain transport branch.
function flattenInvoiceSchema(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return { type: 'array', items: value.map(flattenInvoiceSchema) };
  if (typeof value !== 'object' || value === null) return {};
  const source = value as Record<string, unknown>;
  const flattened: Record<string, unknown> = {};
  const branches = Array.isArray(source.allOf) ? source.allOf : [];
  for (const branch of branches) Object.assign(flattened, flattenInvoiceSchema(branch));
  for (const [key, child] of Object.entries(source)) {
    if (key === 'allOf') continue;
    if (key === 'properties' && typeof child === 'object' && child !== null) {
      flattened.properties = {
        ...(typeof flattened.properties === 'object' && flattened.properties !== null
          ? flattened.properties
          : {}),
        ...Object.fromEntries(
          Object.entries(child).map(([property, schema]) => [
            property,
            flattenInvoiceSchema(schema),
          ]),
        ),
      };
    } else if (key === 'items') {
      flattened.items = flattenInvoiceSchema(child);
    } else {
      flattened[key] = child;
    }
  }
  return flattened;
}

const invoiceResponseSchema = flattenInvoiceSchema(InvoiceDetailResponse);

/**
 * Owner-scoped invoice lookup supplied by the composition root. The order id is a lookup key,
 * never an invoice id fallback: invoice identities are independent and must be joined by the
 * server-owned order snapshot.
 */
export interface OwnedOrderInvoiceReader {
  getOwnedByOrder?(orderId: number, userId: number): Invoice | undefined;
  getByOrderId?(orderId: number, userId: number): Invoice | undefined;
  findOwnedByOrderId?(orderId: number, userId: number): Invoice | undefined;
}

export interface OrdersRouteServices extends AppServices {
  /** Optional until the composition root wires the invoice read capability. */
  invoiceReader?: OwnedOrderInvoiceReader;
}

function optionalInvoiceReader(value: unknown): OwnedOrderInvoiceReader | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.getOwnedByOrder === 'function' ||
    typeof candidate.getByOrderId === 'function' ||
    typeof candidate.findOwnedByOrderId === 'function'
  ) {
    return candidate;
  }
  return undefined;
}

function sendOrderError(
  request: Parameters<typeof sendPublicError>[0],
  reply: Parameters<typeof sendPublicError>[1],
  error: OrderDomainError,
): void {
  switch (error.code) {
    case 'ORDER_NOT_FOUND':
    case 'ORDER_FORBIDDEN':
      // Keep ownership-hiding behavior: forbidden and missing orders are indistinguishable.
      sendPublicError(request, reply, 404, 'ORDER_NOT_FOUND');
      return;
    case 'INVALID_ALLOCATION':
    case 'INVALID_TRANSITION':
    case 'CANCELLATION_NOT_ALLOWED':
    case 'STALE_VERSION':
    case 'IDEMPOTENCY_CONFLICT':
    case 'TRACKING_NOT_ALLOWED':
    case 'OUTSTANDING_BACKORDER':
      sendPublicError(request, reply, 409, error.code);
      return;
  }
}

/** Invoice lifecycle races are expected outcomes of cancelling a finalized credit order. */
function sendInvoiceCancellationError(
  request: Parameters<typeof sendPublicError>[0],
  reply: Parameters<typeof sendPublicError>[1],
  error: InvoiceDomainError,
): void {
  switch (error.code) {
    case 'INVOICE_ALREADY_PAID':
      sendPublicError(request, reply, 409, 'INVOICE_ALREADY_PAID');
      return;
    case 'INVOICE_ALREADY_VOID':
      sendPublicError(request, reply, 409, 'INVOICE_ALREADY_VOID');
      return;
    case 'INVOICE_SETTLEMENT_CONFLICT':
      // The invoice id is intentionally not exposed from this order endpoint. A generic conflict
      // preserves deterministic retry semantics without fabricating parameterized metadata.
      sendPublicError(request, reply, 409, 'CONFLICT');
      return;
    case 'INVOICE_NOT_FOUND':
    case 'INVOICE_FORBIDDEN':
      sendPublicError(request, reply, 404, 'ORDER_NOT_FOUND');
      return;
    case 'INVOICE_TOTAL_MISMATCH':
      sendPublicError(request, reply, 500, 'INTERNAL_ERROR');
      return;
    case 'INVOICE_ALREADY_SETTLED':
    case 'INVOICE_VOIDED':
    case 'INVOICE_NOT_SETTLEABLE':
    case 'INVOICE_SETTLEMENT_INVALID':
    case 'STALE_VERSION':
    case 'IDEMPOTENCY_CONFLICT':
      sendPublicError(request, reply, 409, 'CONFLICT');
      return;
  }
}

function auditContext(userId: number, requestId: string) {
  return { actor: { type: 'user' as const, userId }, requestId };
}

export default function ordersRoutes(
  app: FastifyInstance,
  { services }: { services: OrdersRouteServices },
): void {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.get(
    '/api/orders',
    {
      preHandler: [requireCustomer(services.sessions)],
      schema: {
        querystring: OrderListQuery,
        response: {
          200: OrderListResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    (request) =>
      services.orders.listOwned(
        request.authenticatedUser!.id,
        request.query.page,
        request.query.pageSize,
      ),
  );

  typed.get(
    '/api/orders/:orderId',
    {
      schema: {
        params: OrderIdParam,
        response: { 200: OrderDetailResponse, 400: ErrorResponse, 404: ErrorResponse },
      },
    },
    (request, reply) => {
      const orderId = Number(request.params.orderId);
      const user = request.authenticatedUser;
      const ownerOrAdminOrder =
        user?.role === 'admin'
          ? services.orders.get(orderId)
          : user?.role === 'customer'
            ? services.orders.getOwned(orderId, user.id)
            : undefined;
      const order =
        ownerOrAdminOrder ??
        (services.orderAccess.validate(orderId, request.cookies?.[`qpc_order_${orderId}`])
          ? services.orders.get(orderId)
          : undefined);
      if (!order) {
        sendPublicError(request, reply, 404, 'ORDER_NOT_FOUND');
        return;
      }
      return order;
    },
  );

  typed.get(
    '/api/orders/:orderId/invoice',
    {
      preHandler: [requireCustomer(services.sessions)],
      schema: {
        params: OrderIdParam,
        response: {
          200: invoiceResponseSchema,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    (request, reply) => {
      const orderId = Number(request.params.orderId);
      const userId = request.authenticatedUser!.id;
      if (!Number.isSafeInteger(orderId) || orderId < 1) {
        sendPublicError(request, reply, 400, 'REQUEST_INVALID');
        return;
      }
      const order = services.orders.getOwned(orderId, userId);
      if (!order) {
        sendPublicError(request, reply, 404, 'ORDER_NOT_FOUND');
        return;
      }
      const reader =
        services.invoiceReader ??
        optionalInvoiceReader((services as unknown as { invoices?: unknown }).invoices);
      if (!reader) {
        // The route remains fail-closed while a composition root is being upgraded. No invoice
        // identity is guessed from the order id, and no guest token can reach this handler.
        sendPublicError(request, reply, 404, 'INVOICE_NOT_FOUND');
        return;
      }
      try {
        const invoice =
          reader.getOwnedByOrder?.(orderId, userId) ??
          reader.getByOrderId?.(orderId, userId) ??
          reader.findOwnedByOrderId?.(orderId, userId);
        if (
          !invoice ||
          invoice.orderId !== String(orderId) ||
          invoice.userId !== String(userId) ||
          invoice.country !== request.resolvedCountry
        ) {
          sendPublicError(request, reply, 404, 'INVOICE_NOT_FOUND');
          return;
        }
        return invoice;
      } catch (error) {
        if (error instanceof InvoiceDomainError) {
          sendPublicError(request, reply, 404, 'INVOICE_NOT_FOUND');
          return;
        }
        throw error;
      }
    },
  );

  typed.post(
    '/api/orders/:orderId/cancel',
    {
      preHandler: [requireCustomer(services.sessions)],
      schema: {
        params: OrderIdParam,
        body: CancelOrderBody,
        response: {
          200: OrderDetailResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    (request, reply) => {
      const orderId = Number(request.params.orderId);
      const userId = request.authenticatedUser!.id;
      if (!services.orders.getOwned(orderId, userId)) {
        sendPublicError(request, reply, 404, 'ORDER_NOT_FOUND');
        return;
      }
      try {
        return services.orders.cancel({
          orderId,
          version: request.body.version,
          idempotencyKey: request.body.idempotencyKey,
          context: auditContext(userId, request.id),
        });
      } catch (error) {
        if (error instanceof OrderDomainError) {
          sendOrderError(request, reply, error);
          return;
        }
        if (error instanceof InvoiceDomainError) {
          sendInvoiceCancellationError(request, reply, error);
          return;
        }
        throw error;
      }
    },
  );
}
