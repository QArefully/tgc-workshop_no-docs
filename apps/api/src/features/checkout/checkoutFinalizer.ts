import { parsePersistedCheckoutQuote } from '../payments/paymentRepository.js';
import type { Country } from '@shop/contracts/country';
import type { PersistedCheckoutQuoteV10 } from '@shop/contracts/payments';
import type {
  ResolvedCustomBlendComponent,
  ResolvedCustomBlendSnapshot,
} from '@shop/contracts/custom-blends';
import { AUDIT_ACTIONS, type AuditContext } from '../audit/auditEvent.js';
import type { CreateOrderLineVariantSnapshot } from '../orders/orderTypes.js';
import type { InvoiceService } from '../invoices/invoiceService.js';
import type { CheckoutDependencies, CheckoutResult } from './checkoutTypes.js';

/**
 * Invoice issuance was added after the card finalizer. Keep the dependency optional for direct
 * legacy callers while allowing the application composition root to provide the canonical
 * invoice service for V10 trade-credit orders.
 */
type FinalizerDependencies = Omit<CheckoutDependencies, 'invoices' | 'invoiceService'> & {
  invoices?: Pick<InvoiceService, 'issue'>;
  invoiceService?: Pick<InvoiceService, 'issue'>;
};

function normalizeSnapshotId(value: unknown, name: string): number;
function normalizeSnapshotId(value: unknown, name: string, nullable: true): number | null;
function normalizeSnapshotId(value: unknown, name: string, nullable = false): number | null {
  if (value === null && nullable) return null;
  const normalized =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^[1-9][0-9]*$/.test(value)
        ? Number(value)
        : NaN;
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw new Error(`Invalid persisted checkout ${name}`);
  }
  return normalized;
}

function currentQuote(
  quote: ReturnType<typeof parsePersistedCheckoutQuote>,
): PersistedCheckoutQuoteV10 | undefined {
  return quote.version === 10 ? quote : undefined;
}

/** P13 extends the closed audit union with invoice actions. The capability check keeps this
 * finalizer source-compatible while the two packets converge in the shared worktree. */
function appendInvoiceIssuedAudit(
  dependencies: FinalizerDependencies,
  context: AuditContext,
  input: { invoiceId: number; orderId: number; companyId: number; grossCents: number },
): void {
  if (!(AUDIT_ACTIONS as readonly string[]).includes('invoice.issued')) return;
  dependencies.audit.append({
    action: 'invoice.issued',
    context,
    ...input,
  } as never);
}

/** Finalizes only an already-authorized intent; rollback leaves it resumable. */
export function finalizeAuthorizedCheckout(
  dependencies: FinalizerDependencies,
  idempotencyKey: string,
  auditContext: AuditContext,
  /** Identity country captured from the cart during checkout preparation. */
  country: Country,
  /**
   * Saved site the buyer selected, or `null` for an ad-hoc destination. The quote snapshots the
   * resolved address rather than the record it came from, so the reference is supplied here.
   */
  deliverySiteId: number | null = null,
): CheckoutResult {
  return dependencies.unitOfWork.run(() => {
    const payment = dependencies.payments.load(idempotencyKey);
    if (!payment || payment.status !== 'authorized_pending_finalize' || !payment.quoteJson) {
      return { success: false, error: 'CHECKOUT_FAILED' };
    }
    const quote = parsePersistedCheckoutQuote(payment.quoteJson);
    const v10 = currentQuote(quote);
    const paymentMethod = v10?.paymentMethod ?? 'card';
    const orderCountry = v10?.country ?? country;
    const userId = normalizeSnapshotId(quote.userId, 'user id', true);
    const companyId = normalizeSnapshotId(v10?.companyId ?? null, 'company id', true);
    if (payment.paymentMethod !== paymentMethod) {
      throw new Error('Payment intent method disagrees with its persisted checkout quote');
    }
    if (
      paymentMethod === 'trade_credit' &&
      (payment.companyId !== companyId ||
        payment.userId !== userId ||
        payment.amountCents !== v10?.grossCents)
    ) {
      throw new Error('Payment intent facts disagree with its persisted trade-credit quote');
    }
    const invoiceService = dependencies.invoices ?? dependencies.invoiceService;
    // A credit order is not valid without the canonical invoice capability. Check this before
    // creating an order or touching any reservation so a miswired composition leaves the
    // authorized intent and hold resumable with no artifacts.
    if (
      paymentMethod === 'trade_credit' &&
      (v10 === undefined ||
        invoiceService === undefined ||
        typeof invoiceService.issue !== 'function')
    ) {
      throw new Error('Trade-credit finalization requires invoice capability');
    }
    const createdAt = dependencies.clock.now().toISOString();

    const orderItems = quote.variantLines.map((v, index) => {
      // V10 is a complete immutable snapshot. Do not consult the live catalogue for its line
      // identity; only V8/V9 finalization retains the historical lookup fallback.
      const v10Line = v10?.variantLines[index];
      if (v10 !== undefined && v10Line === undefined) {
        throw new Error('Persisted V10 quote line is missing');
      }
      const variant = v10 === undefined ? dependencies.products.findVariantById(v.variantId) : null;
      const frozenSku =
        v10Line && 'sku' in v10Line && typeof v10Line.sku === 'string' ? v10Line.sku : undefined;
      if (v10 !== undefined && frozenSku === undefined) {
        throw new Error('Persisted V10 quote line is missing an immutable SKU');
      }
      // Plain V9 lines do not carry customBlend; V8 and configured V9 lines do. Keep the
      // structural narrowing at the storage boundary so both legacy and resolved snapshots flow
      // through unchanged.
      const customBlend = 'customBlend' in v ? v.customBlend : undefined;
      const resolvedBlend = isResolvedCustomBlendSnapshot(customBlend) ? customBlend : undefined;
      const resolvedBase = resolvedBlend?.components.find(
        (component: ResolvedCustomBlendComponent) => component.role === 'base',
      );
      const variantSnapshot: CreateOrderLineVariantSnapshot = {
        variantId: v.variantId,
        // V9 already contains the base facts used to price the line. Keep those facts frozen in
        // the order even if a catalogue edit lands after authorization; V8 retains its historic
        // product lookup fallback.
        sku: frozenSku ?? resolvedBase?.sku ?? variant?.sku ?? `SKU-${v.productId}-${v.variantId}`,
        label: resolvedBase?.variantLabel ?? v.variantLabel,
        weightGrams: v.weightGrams,
        // A resolved V9 recipe owns the resulting classification. V8/legacy lines retain the
        // historical base classification carried by the quote line.
        consumptionClassification: (resolvedBlend?.resultClassification ??
          v.consumptionClassification) as 'food' | 'non-food' | 'caution',
        deliveryClass: v.deliveryClass,
      };
      // The quote emits the money split and specification only on configured lines, so a plain
      // line falls back to fee-free defaults and persists byte-identically to prior releases.
      return {
        productId: v.productId,
        productName: v.productName,
        unitPriceCents: v.unitPriceCents,
        quantity: v.quantity,
        discountableTotalCents: v.discountableTotalCents ?? v.lineTotalCents,
        blendingFeeCents: v.blendingFeeCents ?? 0,
        lineTotalCents: v.lineTotalCents,
        variantSnapshot,
        ...(customBlend ? { customBlend } : {}),
      };
    });

    const orderId = dependencies.orders.create({
      country: orderCountry,
      customerName: quote.customer.name,
      customerEmail: quote.customer.email,
      shippingAddress: quote.customer.shippingAddress,
      promoApplied: quote.promoCode,
      promoCategoryScope: quote.promoCategoryScope,
      subtotalCents: quote.subtotalCents,
      discountBaseCents: quote.discountBaseCents,
      discountCents: quote.discountCents,
      totalCents: quote.totalCents,
      paymentMethod,
      companyId,
      netCents: v10?.netCents ?? null,
      vatRateBasisPoints: v10?.vatRateBasisPoints ?? null,
      vatCents: v10?.vatCents ?? null,
      grossCents: v10?.grossCents ?? null,
      userId,
      items: orderItems,
      deliveryMode: quote.deliverySummary.mode,
      deliveryChargeCents: quote.deliverySummary.chargeCents,
      deliveryWeightGrams: quote.deliverySummary.weightGrams,
      // An anonymous checkout owns no saved records, so it can never stamp a site reference.
      deliverySiteId: userId === null ? null : deliverySiteId,
      deliveryAddress: quote.customer.deliveryAddress,
      billingEntity: quote.billingEntity,
      deliverySlot: quote.deliverySlot,
      purchaseOrderReference: quote.purchaseOrderReference,
      createdAt,
    });

    const order = dependencies.orders.findById(orderId);
    if (!order) throw new Error('Created order could not be hydrated');

    dependencies.inventory.commitReservation({
      paymentIdempotencyKey: idempotencyKey,
      orderId,
      ordinaryLines: order.items.map((line) => {
        const variantId =
          line.variantSnapshot?.variantId ??
          dependencies.products.findDefaultVariant(Number(line.productId))?.id ??
          0;
        return {
          orderLineItemId: Number(line.lineId),
          variantId,
          quantity: line.quantity,
        };
      }),
      occurredAt: createdAt,
    });

    if (quote.promoCode)
      dependencies.promos.commitReservation({ paymentIdempotencyKey: idempotencyKey, orderId });

    let invoiceId: number | undefined;
    if (paymentMethod === 'trade_credit' && v10 !== undefined && invoiceService !== undefined) {
      if (companyId === null || userId === null) {
        throw new Error('Trade-credit quote is missing immutable company or user identity');
      }

      // Invoice issuance verifies the authorized hold against the payment row. Link the payment
      // to this newly-created order first, in the same outer transaction; a nested invoice
      // savepoint then atomically creates the document/event/state and commits the exact hold.
      if (
        !dependencies.payments.transition({
          idempotencyKey,
          expectedStatus: 'authorized_pending_finalize',
          nextStatus: 'authorized_pending_finalize',
          orderId,
          amountCents: v10.grossCents,
          updatedAt: createdAt,
        })
      ) {
        throw new Error('Checkout authorization state changed during invoice finalization');
      }

      const invoice = invoiceService.issue({
        orderId,
        paymentIdempotencyKey: idempotencyKey,
        companyId,
        userId,
        country: v10.country,
        billingEntity: v10.billingEntity,
        purchaseOrderReference: v10.purchaseOrderReference,
        netCents: v10.netCents,
        vatRateBasisPoints: v10.vatRateBasisPoints,
        vatCents: v10.vatCents,
        grossCents: v10.grossCents,
        issuedAt: createdAt,
      });
      invoiceId = normalizeSnapshotId(invoice.id, 'invoice id') ?? undefined;

      // Invoice notifications carry only the immutable document identity. The mailbox repository
      // deliberately discards subject/body prose and hydrates the document when read.
      dependencies.mailbox.add({
        recipient: quote.customer.email,
        subject: '',
        body: '',
        kind: 'invoice_issued',
        invoiceId,
        createdAt,
      });
    } else {
      // Order receipts are rendered from the structured order snapshot by the mailbox reader.
      // Keep legacy identity columns empty so checkout never persists generated prose or a locale.
      dependencies.mailbox.add({
        recipient: quote.customer.email,
        subject: '',
        body: '',
        kind: 'order_receipt',
        orderId,
        createdAt,
      });
    }
    dependencies.carts.remove(quote.cartId);
    const result: CheckoutResult = {
      success: true,
      order,
    };
    if (
      !dependencies.payments.transition({
        idempotencyKey,
        expectedStatus: 'authorized_pending_finalize',
        nextStatus: 'succeeded',
        orderId,
        amountCents: quote.totalCents,
        responseJson: JSON.stringify(result),
        updatedAt: createdAt,
      })
    ) {
      throw new Error('Checkout authorization state changed during finalization');
    }
    dependencies.audit.append({
      action: 'order.created',
      context: auditContext,
      orderId,
      totalCents: quote.totalCents,
      itemCount: quote.variantLines.reduce((total, item) => total + item.quantity, 0),
    });
    if (invoiceId !== undefined && companyId !== null) {
      appendInvoiceIssuedAudit(dependencies, auditContext, {
        invoiceId,
        orderId,
        companyId,
        grossCents: quote.totalCents,
      });
    }
    if (paymentMethod === 'card') {
      dependencies.audit.append({
        action: 'payment.succeeded',
        context: auditContext,
        paymentId: payment.id,
        orderId,
        amountCents: quote.totalCents,
      });
    }
    dependencies.audit.append({
      action: 'checkout.cart_consumed',
      context: auditContext,
      cartId: quote.cartId,
    });
    return result;
  });
}

function isResolvedCustomBlendSnapshot(value: unknown): value is ResolvedCustomBlendSnapshot {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'ruleVersion' in value &&
    value.ruleVersion === 1
  );
}
