import type { DataExportResponse, ExportedInvoice } from '@shop/contracts/account-depth';
import type { Country } from '@shop/contracts/country';
import type { Invoice } from '@shop/contracts/trade-credit';
import { dataExportCopy } from '@shop/localisation/messages/asyncContent';
import type { UnitOfWork } from '../../db/unitOfWork.js';
import type { AuditContext } from '../audit/auditEvent.js';
import type { AuditWriter, Clock } from '../audit/auditService.js';
import type { SessionService } from '../auth/sessionService.js';
import type { SessionUser } from '../auth/sessionRepository.js';
import { toPublicUser } from '../auth/authService.js';
import type { MailboxRepository } from '../mailbox/mailboxRepository.js';
import type { OrderRepository } from '../orders/orderRepository.js';
import type { PreferencesService } from '../preferences/preferencesService.js';
import type { SavedListService } from '../savedLists/savedListService.js';
import type { InvoiceRepository } from '../invoices/invoiceRepository.js';
import {
  toBillingEntity,
  type BillingEntityRepository,
} from '../tradeAccount/billingEntityRepository.js';
import {
  toDeliverySite,
  type DeliverySiteRepository,
} from '../tradeAccount/deliverySiteRepository.js';

export interface DataExportService {
  /** Builds the caller-owned snapshot and atomically records its local delivery/audit side effects. */
  exportForUser(input: {
    user: SessionUser;
    currentSessionToken: string;
    context: AuditContext;
  }): DataExportResponse;
}

export interface DataExportServiceDependencies {
  unitOfWork: UnitOfWork;
  audit: AuditWriter;
  clock: Clock;
  sessions: SessionService;
  orders: Pick<OrderRepository, 'listExportOwned'>;
  /**
   * Invoice persistence is optional for compatibility with pre-invoice composition. When present,
   * the export discovers invoices through already-owned orders and re-checks ownership before
   * projecting the document. This deliberately avoids any company-wide invoice listing.
   */
  invoices?: Pick<InvoiceRepository, 'findByOrderId' | 'findOwnedById'>;
  savedLists: Pick<SavedListService, 'list' | 'get'>;
  deliverySites: DeliverySiteRepository;
  billingEntities: BillingEntityRepository;
  preferences: PreferencesService;
  mailbox: MailboxRepository;
}

/**
 * Projects an invoice envelope into the account-export allowlist. In particular, payment
 * idempotency, lifecycle events, lifecycle version, and settlement idempotency never cross this
 * boundary. Nested lines and billing facts are copied field-by-field as well, so a future invoice
 * document field cannot leak merely because it was added to the source envelope.
 */
function toExportedInvoice(invoice: Invoice): ExportedInvoice {
  return {
    version: invoice.version,
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    orderId: invoice.orderId,
    companyId: invoice.companyId,
    userId: invoice.userId,
    country: invoice.country,
    paymentMethod: invoice.paymentMethod,
    currency: invoice.currency,
    ...(invoice.terms === undefined ? {} : { terms: invoice.terms }),
    ...(invoice.termsDays === undefined ? {} : { termsDays: invoice.termsDays }),
    billingEntity: {
      legalName: invoice.billingEntity.legalName,
      registrationNumber: invoice.billingEntity.registrationNumber,
      vatNumber: invoice.billingEntity.vatNumber,
      address: {
        line1: invoice.billingEntity.address.line1,
        ...(invoice.billingEntity.address.line2 === undefined
          ? {}
          : { line2: invoice.billingEntity.address.line2 }),
        city: invoice.billingEntity.address.city,
        ...(invoice.billingEntity.address.region === undefined
          ? {}
          : { region: invoice.billingEntity.address.region }),
        postcode: invoice.billingEntity.address.postcode,
        countryCode: invoice.billingEntity.address.countryCode,
      },
    },
    purchaseOrderReference: invoice.purchaseOrderReference,
    lines: invoice.lines.map((line) => ({
      lineId: line.lineId,
      description: line.description,
      ...(line.productId === undefined ? {} : { productId: line.productId }),
      ...(line.variantId === undefined ? {} : { variantId: line.variantId }),
      ...(line.sku === undefined ? {} : { sku: line.sku }),
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      netCents: line.netCents,
    })),
    netCents: invoice.netCents,
    vatRateBasisPoints: invoice.vatRateBasisPoints,
    vatCents: invoice.vatCents,
    grossCents: invoice.grossCents,
    issuedAt: invoice.issuedAt,
    dueAt: invoice.dueAt,
    status: invoice.status,
    settledAt: invoice.settledAt,
  };
}

/**
 * Returns only invoices attached to the caller's order rows. The second repository lookup is an
 * ownership guard even though the first lookup started from an owned order: invoice and order
 * identities are independently persisted and a mismatch must fail closed rather than disclose a
 * company neighbour's document.
 */
function listExportOwnedInvoices(
  userId: number,
  ownedOrders: DataExportResponse['orders'],
  invoices: Pick<InvoiceRepository, 'findByOrderId' | 'findOwnedById'> | undefined,
  now: string,
): ExportedInvoice[] {
  if (!invoices) return [];

  return ownedOrders.flatMap((order) => {
    const orderId = Number(order.id);
    // Only trade-credit orders can have an invoice. The company identity check prevents an
    // invoice with a mismatched company from becoming an accidental cross-company disclosure.
    if (
      order.paymentMethod !== 'trade_credit' ||
      order.companyId === undefined ||
      !Number.isSafeInteger(orderId)
    ) {
      return [];
    }
    const candidate = invoices.findByOrderId(orderId, now);
    if (!candidate) return [];
    const invoiceId = Number(candidate.id);
    if (!Number.isSafeInteger(invoiceId) || invoiceId < 1) return [];
    const owned = invoices.findOwnedById(invoiceId, userId, now);
    if (
      !owned ||
      owned.id !== candidate.id ||
      owned.orderId !== order.id ||
      owned.userId !== String(userId) ||
      owned.companyId !== order.companyId ||
      owned.orderId !== candidate.orderId ||
      owned.companyId !== candidate.companyId ||
      owned.userId !== candidate.userId
    ) {
      return [];
    }
    return [toExportedInvoice(owned)];
  });
}

/**
 * Produces a deliberately allowlisted account snapshot. Repository rows and mail/audit records
 * never cross this boundary directly, so credential, payment, and session-token columns cannot
 * become export fields through an incidental persistence change.
 */
export function createDataExportService({
  unitOfWork,
  audit,
  clock,
  sessions,
  orders,
  invoices,
  savedLists,
  deliverySites,
  billingEntities,
  preferences,
  mailbox,
}: DataExportServiceDependencies): DataExportService {
  return {
    exportForUser({ user, currentSessionToken, context }) {
      if (context.actor.type !== 'user' || context.actor.userId !== user.id) {
        throw new Error('Data export audit requires the authenticated user as actor');
      }
      return unitOfWork.run(() => {
        const exportedAt = clock.now().toISOString();
        const ownedOrders = orders.listExportOwned(user.id);
        const customBlends = ownedOrders.flatMap((order) =>
          order.items.flatMap((item) => (item.customBlend ? [item.customBlend] : [])),
        );
        const snapshot: DataExportResponse = {
          exportedAt,
          profile: toPublicUser(user),
          deliverySites: deliverySites.listActive(user.id).map(toDeliverySite),
          billingEntities: billingEntities.listActive(user.id).map(toBillingEntity),
          orders: ownedOrders,
          invoices: listExportOwnedInvoices(user.id, ownedOrders, invoices, exportedAt),
          savedLists: savedLists.list(user.id).flatMap((list) => {
            const detail = savedLists.get(user.id, Number(list.listId));
            return detail.ok ? [detail.value] : [];
          }),
          customBlends,
          sessions: sessions.listForUser(user.id, currentSessionToken),
          preferences: preferences.get(user.id),
          // Company account export is not part of the P5 scope; retain the contract field while
          // avoiding a second, unauthorized company-membership read path here.
          companyMemberships: [],
        };
        const country = user.country as Country;
        const copy = dataExportCopy(country);
        mailbox.add({
          recipient: user.email,
          subject: copy.subject,
          body: copy.body,
          kind: 'template',
          templateKey: 'data_export_ready',
          templateParams: {},
          country,
          createdAt: exportedAt,
        });
        audit.append({ action: 'auth.data_exported', userId: user.id, context });
        return snapshot;
      });
    },
  };
}
