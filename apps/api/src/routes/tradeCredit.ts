import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import {
  CreditAccountMemberResponse,
  CreditAccountQuery,
  InvoiceDetailResponse,
  InvoiceIdParam,
} from '@shop/contracts/trade-credit';
import { ErrorResponse } from '@shop/contracts/common';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SessionService } from '../features/auth/sessionService.js';
import {
  CreditAccountError,
  type CreditAccountService,
} from '../features/tradeCredit/creditAccountService.js';
import { InvoiceDomainError } from '../features/invoices/invoiceErrors.js';
import type { InvoiceService } from '../features/invoices/invoiceService.js';
import { requireCustomer } from '../plugins/auth.js';
import { sendPublicError } from '../utils/errors.js';

// The invoice contract includes TypeBox integrity callbacks in `allOf` branches. Those callbacks
// are enforced by InvoiceService/repository; fast-json-stringify cannot merge the callback
// branches, so recursively flatten the plain schema branches for response serialization.
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

/** Dependencies for buyer-owned credit and invoice reads. No company id comes from the caller. */
export interface TradeCreditRouteServices {
  sessions: SessionService;
  creditAccounts: Pick<CreditAccountService, 'getMember'>;
  invoices: Pick<InvoiceService, 'getOwned'>;
}

const validationErrorHandler = (
  error: Error & { validation?: unknown; code?: string },
  request: FastifyRequest,
  reply: FastifyReply,
): void => {
  if (error.validation || error.code === 'FST_ERR_CTP_INVALID_JSON_BODY') {
    sendPublicError(request, reply, 400, 'REQUEST_INVALID');
    return;
  }
  throw error;
};

function positiveId(value: string): number | undefined {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

function sendCreditError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: CreditAccountError,
): void {
  switch (error.code) {
    case 'CREDIT_ACCOUNT_FORBIDDEN':
      // Member reads never disclose whether another company has an account.
      sendPublicError(request, reply, 404, 'CREDIT_ACCOUNT_NOT_FOUND');
      return;
    case 'CREDIT_ACCOUNT_NOT_FOUND':
      sendPublicError(request, reply, 404, 'CREDIT_ACCOUNT_NOT_FOUND');
      return;
    case 'INVALID_QUERY':
      sendPublicError(request, reply, 400, 'INVALID_QUERY');
      return;
    case 'INVALID_INPUT':
    case 'CREDIT_LIMIT_INVALID':
    case 'CREDIT_TERMS_INVALID':
      sendPublicError(request, reply, 400, error.code);
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
        typeof error.meta?.availableCreditCents === 'number'
      ) {
        sendPublicError(request, reply, 409, 'CREDIT_LIMIT_EXCEEDED', {
          requestedCents: error.meta.requestedCents,
          availableCreditCents: error.meta.availableCreditCents,
        });
      } else {
        // A malformed domain payload is an internal failure; never fabricate financial values or
        // reflect a domain error's prose into the public response.
        sendPublicError(request, reply, 500, 'INTERNAL_ERROR');
      }
      return;
    case 'STALE_VERSION':
    case 'IDEMPOTENCY_CONFLICT':
      sendPublicError(request, reply, 409, error.code);
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
      // Missing and another buyer's invoice are intentionally indistinguishable.
      sendPublicError(request, reply, 404, 'INVOICE_NOT_FOUND');
      return;
    case 'INVOICE_SETTLEMENT_INVALID':
      sendPublicError(request, reply, 400, 'INVOICE_SETTLEMENT_INVALID', {
        invoiceId: String((request.params as { invoiceId?: string }).invoiceId ?? '0'),
      });
      return;
    case 'INVOICE_SETTLEMENT_CONFLICT':
      sendPublicError(request, reply, 409, 'INVOICE_SETTLEMENT_CONFLICT', {
        invoiceId: String((request.params as { invoiceId?: string }).invoiceId ?? '0'),
      });
      return;
    case 'INVOICE_ALREADY_PAID':
    case 'INVOICE_VOIDED':
    case 'INVOICE_ALREADY_SETTLED':
    case 'INVOICE_ALREADY_VOID':
    case 'INVOICE_NOT_SETTLEABLE':
      sendPublicError(request, reply, 409, error.code);
      return;
    case 'INVOICE_TOTAL_MISMATCH':
      sendPublicError(request, reply, 500, 'INTERNAL_ERROR');
      return;
    case 'STALE_VERSION':
      sendPublicError(request, reply, 409, 'STALE_VERSION');
      return;
    case 'IDEMPOTENCY_CONFLICT':
      sendPublicError(request, reply, 409, 'IDEMPOTENCY_CONFLICT');
      return;
  }
}

/** Buyer credit summary and owner-scoped immutable invoice reads. */
export default function tradeCreditRoutes(
  app: FastifyInstance,
  { services }: { services: TradeCreditRouteServices },
): void {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();
  const auth = [requireCustomer(services.sessions)];

  const memberCreditOptions = {
    preHandler: auth,
    schema: {
      querystring: CreditAccountQuery,
      response: {
        200: CreditAccountMemberResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
      },
    },
    errorHandler: validationErrorHandler,
  } as const;

  // Keep the company-facing spelling and the account spelling as compatibility aliases. Both
  // resolve the authenticated membership only; neither accepts a company identifier.
  for (const path of ['/api/company/credit', '/api/account/credit']) {
    typed.get(path, memberCreditOptions, (request, reply) => {
      try {
        reply.code(200).send(services.creditAccounts.getMember(request.authenticatedUser!.id));
      } catch (error) {
        if (error instanceof CreditAccountError) {
          sendCreditError(request, reply, error);
          return;
        }
        throw error;
      }
    });
  }

  const invoiceOptions = {
    preHandler: auth,
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
    errorHandler: validationErrorHandler,
  } as const;

  for (const path of ['/api/account/invoices/:invoiceId', '/api/invoices/:invoiceId']) {
    typed.get(path, invoiceOptions, (request, reply) => {
      const invoiceId = positiveId(request.params.invoiceId);
      if (invoiceId === undefined) {
        sendPublicError(request, reply, 400, 'REQUEST_INVALID');
        return;
      }
      try {
        const invoice = services.invoices.getOwned(invoiceId, request.authenticatedUser!.id);
        // The buyer's account country is the standing country for this read. A country mismatch
        // is hidden as missing so a buyer cannot use an invoice id as a cross-market probe.
        if (invoice.country !== request.resolvedCountry) {
          sendPublicError(request, reply, 404, 'INVOICE_NOT_FOUND');
          return;
        }
        return invoice;
      } catch (error) {
        if (error instanceof InvoiceDomainError) {
          sendInvoiceError(request, reply, error);
          return;
        }
        throw error;
      }
    });
  }
}
