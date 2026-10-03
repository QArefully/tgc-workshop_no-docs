import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import {
  AdminCreditAccountDetailResponse,
  AdminCreditAccountListQuery,
  AdminCreditAccountListResponse,
  AdminCreditAccountUpdateBody,
  AdminInvoiceListQuery,
  AdminInvoiceListResponse,
  AdminInvoiceSettlementBody,
  CreditAccountIdParam,
  InvoiceDetailResponse,
  InvoiceIdParam,
  UpdateCreditAccountLimitBody,
  UpdateCreditAccountStateBody,
  VoidInvoiceBody,
} from '@shop/contracts/trade-credit';
import { ErrorResponse } from '@shop/contracts/common';
import type { Country } from '@shop/contracts/country';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SessionService } from '../features/auth/sessionService.js';
import {
  CreditAccountError,
  type CreditAccountAdminQuery,
  type CreditAccountService,
} from '../features/tradeCredit/creditAccountService.js';
import { InvoiceDomainError } from '../features/invoices/invoiceErrors.js';
import type { InvoiceService } from '../features/invoices/invoiceService.js';
import type { AuditContext } from '../features/audit/auditEvent.js';
import { requireAdmin } from '../plugins/auth.js';
import { sendPublicError } from '../utils/errors.js';

// Keep response serialization compatible with fast-json-stringify. Invoice integrity is checked
// by the invoice service/repository before this boundary; its TypeBox callback branches cannot be
// merged by Fastify's serializer, so recursively flatten plain schema branches.
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
const adminInvoiceListResponseSchema = flattenInvoiceSchema(AdminInvoiceListResponse);

/** Admin route dependencies are explicit so the composition root owns all concrete wiring. */
export interface AdminCreditRouteServices {
  sessions: SessionService;
  creditAccounts: Pick<
    CreditAccountService,
    'listAdmin' | 'getAdminDetail' | 'getAdmin' | 'update' | 'updateLimit' | 'updateState'
  >;
  invoices: Pick<InvoiceService, 'listAdmin' | 'getAdmin' | 'settle' | 'void'>;
}

const auditContext = (
  userId: number,
  requestId: string,
  standingCountry: Country,
): AuditContext => ({
  actor: { type: 'user', userId },
  requestId,
  standingCountry,
});

function safeId(value: string): number | undefined {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

function listCreditQuery(query: {
  companyId?: string;
  state?: 'active' | 'on_hold' | 'suspended';
  status?: 'active' | 'on_hold' | 'suspended';
  page?: number;
  pageSize?: number;
}): CreditAccountAdminQuery {
  return {
    companyId: query.companyId === undefined ? undefined : Number(query.companyId),
    state: query.state,
    status: query.status,
    page: query.page,
    pageSize: query.pageSize,
  };
}

function listInvoiceQuery(query: {
  companyId?: string;
  status?: 'open' | 'overdue' | 'paid' | 'voided';
  page?: number;
  pageSize?: number;
}): { companyId?: number; status?: typeof query.status; page?: number; pageSize?: number } {
  return {
    companyId: query.companyId === undefined ? undefined : Number(query.companyId),
    status: query.status,
    page: query.page,
    pageSize: query.pageSize,
  };
}

function requestInvoiceId(request: FastifyRequest): string {
  const params = request.params as { invoiceId?: string };
  return params.invoiceId ?? '0';
}

function sendCreditError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: CreditAccountError,
): void {
  switch (error.code) {
    case 'CREDIT_ACCOUNT_NOT_FOUND':
    case 'CREDIT_ACCOUNT_FORBIDDEN':
      // Country-scoped admin reads do not disclose records outside the standing country.
      sendPublicError(request, reply, 404, 'CREDIT_ACCOUNT_NOT_FOUND');
      return;
    case 'INVALID_QUERY':
      sendPublicError(request, reply, 400, 'INVALID_QUERY');
      return;
    case 'INVALID_INPUT':
      sendPublicError(request, reply, 400, 'INVALID_INPUT');
      return;
    case 'CREDIT_LIMIT_INVALID':
      sendPublicError(request, reply, 400, 'CREDIT_LIMIT_INVALID');
      return;
    case 'CREDIT_TERMS_INVALID':
      sendPublicError(request, reply, 400, 'CREDIT_TERMS_INVALID');
      return;
    case 'CREDIT_ACCOUNT_ALREADY_EXISTS':
      sendPublicError(request, reply, 409, 'CREDIT_ACCOUNT_ALREADY_EXISTS');
      return;
    case 'CREDIT_ACCOUNT_ON_HOLD':
      sendPublicError(request, reply, 409, 'CREDIT_ACCOUNT_ON_HOLD');
      return;
    case 'CREDIT_ACCOUNT_SUSPENDED':
      sendPublicError(request, reply, 409, 'CREDIT_ACCOUNT_SUSPENDED');
      return;
    case 'CREDIT_NOT_ELIGIBLE':
      sendPublicError(request, reply, 409, 'CREDIT_NOT_ELIGIBLE');
      return;
    case 'CREDIT_LIMIT_EXCEEDED':
      if (
        typeof error.meta?.requestedCents === 'number' &&
        Number.isSafeInteger(error.meta.requestedCents) &&
        error.meta.requestedCents >= 0 &&
        typeof error.meta?.availableCreditCents === 'number' &&
        Number.isSafeInteger(error.meta.availableCreditCents) &&
        error.meta.availableCreditCents >= 0
      ) {
        sendPublicError(request, reply, 409, 'CREDIT_LIMIT_EXCEEDED', {
          requestedCents: error.meta.requestedCents,
          availableCreditCents: error.meta.availableCreditCents,
        });
      } else {
        sendPublicError(request, reply, 500, 'INTERNAL_ERROR');
      }
      return;
    case 'STALE_VERSION':
      sendPublicError(request, reply, 409, 'STALE_VERSION');
      return;
    case 'IDEMPOTENCY_CONFLICT':
      sendPublicError(request, reply, 409, 'IDEMPOTENCY_CONFLICT');
      return;
    case 'HOLD_NOT_FOUND':
      sendPublicError(request, reply, 404, 'NOT_FOUND');
      return;
    case 'HOLD_INVALID_TRANSITION':
      sendPublicError(request, reply, 409, 'CONFLICT');
      return;
    case 'NO_ACTIVE_MEMBERSHIP':
    case 'MEMBERSHIP_ROLE_NOT_ELIGIBLE':
      sendPublicError(request, reply, 404, 'CREDIT_ACCOUNT_NOT_FOUND');
      return;
    case 'CREDIT_DATA_CORRUPT':
      sendPublicError(request, reply, 500, 'INTERNAL_ERROR');
      return;
  }
}

function sendInvoiceError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: InvoiceDomainError,
): void {
  switch (error.code) {
    case 'INVOICE_NOT_FOUND':
    case 'INVOICE_FORBIDDEN':
      sendPublicError(request, reply, 404, 'INVOICE_NOT_FOUND');
      return;
    case 'INVOICE_SETTLEMENT_INVALID':
      sendPublicError(request, reply, 400, 'INVOICE_SETTLEMENT_INVALID', {
        invoiceId: requestInvoiceId(request),
      });
      return;
    case 'INVOICE_SETTLEMENT_CONFLICT':
      sendPublicError(request, reply, 409, 'INVOICE_SETTLEMENT_CONFLICT', {
        invoiceId: requestInvoiceId(request),
      });
      return;
    case 'INVOICE_ALREADY_PAID':
    case 'INVOICE_VOIDED':
    case 'INVOICE_ALREADY_SETTLED':
    case 'INVOICE_ALREADY_VOID':
    case 'INVOICE_NOT_SETTLEABLE':
    case 'STALE_VERSION':
    case 'IDEMPOTENCY_CONFLICT':
      sendPublicError(request, reply, 409, error.code);
      return;
    case 'INVOICE_TOTAL_MISMATCH':
      sendPublicError(request, reply, 500, 'INTERNAL_ERROR');
      return;
  }
}

function sendValidationError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
): boolean {
  const candidate = error as { validation?: unknown; code?: string };
  if (candidate.validation || candidate.code === 'FST_ERR_CTP_INVALID_JSON_BODY') {
    sendPublicError(request, reply, 400, 'REQUEST_INVALID');
    return true;
  }
  return false;
}

/** Country-scoped administrator credit-account and invoice command/read surface. */
export default function adminCreditRoutes(
  app: FastifyInstance,
  { services }: { services: AdminCreditRouteServices },
): void {
  app.addHook('preValidation', requireAdmin(services.sessions));
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.get(
    '/api/admin/credit-accounts',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        querystring: AdminCreditAccountListQuery,
        response: {
          200: AdminCreditAccountListResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    (request, reply) => {
      try {
        return services.creditAccounts.listAdmin(
          listCreditQuery(request.query),
          request.resolvedCountry,
        );
      } catch (error) {
        if (error instanceof CreditAccountError) {
          sendCreditError(request, reply, error);
          return;
        }
        throw error;
      }
    },
  );

  typed.get(
    '/api/admin/credit-accounts/:creditAccountId',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        params: CreditAccountIdParam,
        response: {
          200: AdminCreditAccountDetailResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    (request, reply) => {
      const accountId = safeId(request.params.creditAccountId);
      if (accountId === undefined) {
        sendPublicError(request, reply, 400, 'REQUEST_INVALID');
        return;
      }
      try {
        return services.creditAccounts.getAdminDetail(accountId, request.resolvedCountry);
      } catch (error) {
        if (error instanceof CreditAccountError) {
          sendCreditError(request, reply, error);
          return;
        }
        throw error;
      }
    },
  );

  const updateAccount = (
    request: FastifyRequest & {
      params: { creditAccountId: string };
      body: {
        expectedVersion: number;
        idempotencyKey: string;
        creditLimitCents?: number;
        state?: 'active' | 'on_hold' | 'suspended';
        reason?: string;
      };
    },
    reply: FastifyReply,
    operation: 'all' | 'limit' | 'state',
  ): void => {
    const accountId = safeId(request.params.creditAccountId);
    if (accountId === undefined) {
      sendPublicError(request, reply, 400, 'REQUEST_INVALID');
      return;
    }
    try {
      const context = auditContext(
        request.authenticatedUser!.id,
        request.id,
        request.resolvedCountry,
      );
      const result =
        operation === 'limit'
          ? services.creditAccounts.updateLimit(
              accountId,
              request.body,
              context,
              request.resolvedCountry,
            )
          : operation === 'state'
            ? services.creditAccounts.updateState(
                accountId,
                request.body,
                context,
                request.resolvedCountry,
              )
            : services.creditAccounts.update(
                accountId,
                request.body,
                context,
                request.resolvedCountry,
              );
      reply.code(200).send(result);
    } catch (error) {
      if (error instanceof CreditAccountError) {
        sendCreditError(request, reply, error);
        return;
      }
      throw error;
    }
  };

  typed.patch(
    '/api/admin/credit-accounts/:creditAccountId',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        params: CreditAccountIdParam,
        body: AdminCreditAccountUpdateBody,
        response: {
          200: AdminCreditAccountDetailResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
      errorHandler(error, request, reply) {
        if (sendValidationError(request, reply, error)) return;
        throw error;
      },
    },
    (request, reply) => updateAccount(request, reply, 'all'),
  );

  typed.patch(
    '/api/admin/credit-accounts/:creditAccountId/limit',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        params: CreditAccountIdParam,
        body: UpdateCreditAccountLimitBody,
        response: {
          200: AdminCreditAccountDetailResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
      errorHandler(error, request, reply) {
        if (sendValidationError(request, reply, error)) return;
        throw error;
      },
    },
    (request, reply) => updateAccount(request, reply, 'limit'),
  );

  typed.patch(
    '/api/admin/credit-accounts/:creditAccountId/state',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        params: CreditAccountIdParam,
        body: UpdateCreditAccountStateBody,
        response: {
          200: AdminCreditAccountDetailResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
      errorHandler(error, request, reply) {
        if (sendValidationError(request, reply, error)) return;
        throw error;
      },
    },
    (request, reply) => updateAccount(request, reply, 'state'),
  );

  typed.get(
    '/api/admin/invoices',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        querystring: AdminInvoiceListQuery,
        response: {
          200: adminInvoiceListResponseSchema,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    (request, reply) => {
      try {
        return services.invoices.listAdmin(
          listInvoiceQuery(request.query),
          request.resolvedCountry,
        );
      } catch (error) {
        if (error instanceof InvoiceDomainError) {
          if (error.code === 'INVOICE_SETTLEMENT_INVALID') {
            sendPublicError(request, reply, 400, 'INVALID_QUERY');
          } else {
            sendInvoiceError(request, reply, error);
          }
          return;
        }
        throw error;
      }
    },
  );

  typed.get(
    '/api/admin/invoices/:invoiceId',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        params: InvoiceIdParam,
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
      const invoiceId = safeId(request.params.invoiceId);
      if (invoiceId === undefined) {
        sendPublicError(request, reply, 400, 'REQUEST_INVALID');
        return;
      }
      try {
        return services.invoices.getAdmin(invoiceId, request.resolvedCountry);
      } catch (error) {
        if (error instanceof InvoiceDomainError) {
          sendInvoiceError(request, reply, error);
          return;
        }
        throw error;
      }
    },
  );

  const settleInvoice = (
    request: FastifyRequest & {
      params: { invoiceId: string };
      body: { expectedVersion: number; idempotencyKey: string };
    },
    reply: FastifyReply,
  ): void => {
    const invoiceId = safeId(request.params.invoiceId);
    if (invoiceId === undefined) {
      sendPublicError(request, reply, 400, 'REQUEST_INVALID');
      return;
    }
    try {
      reply.code(200).send(
        services.invoices.settle({
          invoiceId,
          expectedVersion: request.body.expectedVersion,
          idempotencyKey: request.body.idempotencyKey,
          context: auditContext(request.authenticatedUser!.id, request.id, request.resolvedCountry),
          standingCountry: request.resolvedCountry,
          actorUserId: request.authenticatedUser!.id,
        }),
      );
    } catch (error) {
      if (error instanceof InvoiceDomainError) {
        sendInvoiceError(request, reply, error);
        return;
      }
      throw error;
    }
  };

  typed.post(
    '/api/admin/invoices/:invoiceId/settle',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        params: InvoiceIdParam,
        body: AdminInvoiceSettlementBody,
        response: {
          200: invoiceResponseSchema,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
      errorHandler(error, request, reply) {
        if (sendValidationError(request, reply, error)) return;
        throw error;
      },
    },
    (request, reply) => settleInvoice(request, reply),
  );

  typed.post(
    '/api/admin/invoices/:invoiceId/void',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        params: InvoiceIdParam,
        body: VoidInvoiceBody,
        response: {
          200: invoiceResponseSchema,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
      errorHandler(error, request, reply) {
        if (sendValidationError(request, reply, error)) return;
        throw error;
      },
    },
    (request, reply) => {
      const invoiceId = safeId(request.params.invoiceId);
      if (invoiceId === undefined) {
        sendPublicError(request, reply, 400, 'REQUEST_INVALID');
        return;
      }
      try {
        reply.code(200).send(
          services.invoices.void({
            invoiceId,
            expectedVersion: request.body.expectedVersion,
            idempotencyKey: request.body.idempotencyKey,
            reason: request.body.reason,
            context: auditContext(
              request.authenticatedUser!.id,
              request.id,
              request.resolvedCountry,
            ),
            standingCountry: request.resolvedCountry,
            actorUserId: request.authenticatedUser!.id,
          }),
        );
      } catch (error) {
        if (error instanceof InvoiceDomainError) {
          sendInvoiceError(request, reply, error);
          return;
        }
        throw error;
      }
    },
  );
}
