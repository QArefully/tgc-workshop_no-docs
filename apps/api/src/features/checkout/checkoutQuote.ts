import type { Cart } from '@shop/contracts/cart';
import {
  CURRENT_PERSISTED_CHECKOUT_QUOTE_VERSION,
  parsePersistedCheckoutQuote as parseContractPersistedCheckoutQuote,
  type PaymentMethod,
  type PersistedCheckoutQuoteV10,
} from '@shop/contracts/payments';
import { SUPPORTED_COUNTRIES, type Country } from '@shop/contracts/country';
import { countryProfile } from '@shop/contracts/country-profiles';
import { formatPostalAddress } from '@shop/contracts/address';
import { calculateDiscount, resolvePromoScope, type ValidPromo } from '../promos/promoService.js';
import type { PersistedCheckoutQuote } from '../payments/paymentRepository.js';
import type { CheckoutParams, ResolvedCheckoutCommitments } from './checkoutTypes.js';
import type { InventoryReservationAllocation } from '../inventory/inventoryTypes.js';
import { quoteCartDelivery } from '../delivery/deliveryRules.js';
import {
  calculateInvoiceTotals,
  type InvoiceAmounts,
  type InvoiceVatRate,
} from '../tradeCredit/tradeCreditRules.js';

type CreditTerms = 'net_30' | 30;
type QuoteAccountingTotals = Partial<InvoiceAmounts> & {
  totalCents?: number;
  vatRateBasisPoints?: InvoiceVatRate;
};

/** Optional server-owned facts supplied by the method-aware checkout workflow. */
export interface CheckoutQuoteAccounting {
  country?: Country;
  paymentMethod?: PaymentMethod;
  userId?: number | string | null;
  companyId?: number | string | null;
  netCents?: number;
  vatRateBasisPoints?: InvoiceVatRate;
  vatCents?: number;
  grossCents?: number;
  totalCents?: number;
  terms?: CreditTerms | null;
  termsDays?: 30 | null;
  preparedAt?: string;
  invoiceTotals?: QuoteAccountingTotals;
  totals?: QuoteAccountingTotals;
}

type CheckoutQuoteCheckout = Omit<CheckoutParams, 'cardNumber' | 'cardExpiry' | 'cardCvc'> &
  Partial<Pick<CheckoutParams, 'cardNumber' | 'cardExpiry' | 'cardCvc'>> & {
    country?: Country;
    paymentMethod?: PaymentMethod;
    companyId?: number | string | null;
    netCents?: number;
    vatRateBasisPoints?: InvoiceVatRate;
    vatCents?: number;
    grossCents?: number;
    totalCents?: number;
    terms?: CreditTerms | null;
    termsDays?: 30 | null;
    preparedAt?: string;
    /** Compatibility seam for workflows that keep method facts under an accounting object. */
    accounting?: CheckoutQuoteAccounting;
    invoiceTotals?: QuoteAccountingTotals;
    totals?: QuoteAccountingTotals;
  };

interface CheckoutQuoteFacts extends CheckoutQuoteAccounting {
  /** The workflow may supply the accounting tuple under this descriptive alias. */
  totals?: QuoteAccountingTotals;
}

type AliasCandidate = readonly [source: string, value: unknown];

/**
 * Reads compatibility aliases without allowing one transport shape to silently override another.
 * Values are normalized before comparison so numeric/string ids and the two net-30 spellings keep
 * their intended semantic equivalence.
 */
function resolveAlias<T>(
  name: string,
  candidates: readonly AliasCandidate[],
  normalize: (value: unknown) => T,
): T | undefined {
  let resolved: T | undefined;
  let present = false;
  for (const [, value] of candidates) {
    if (value === undefined) continue;
    const normalized = normalize(value);
    if (present && !Object.is(resolved, normalized)) {
      throw new Error(`${name} aliases must agree`);
    }
    resolved = normalized;
    present = true;
  }
  return present ? resolved : undefined;
}

function normalizePositiveId(value: unknown, name: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${name}`);
    return value;
  }
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`Invalid ${name}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`Invalid ${name}`);
  return parsed;
}

function normalizeQuoteUserId(value: unknown): number | null {
  if (value === null) return null;
  const normalized = normalizePositiveId(value, 'quote user');
  if (normalized === null) throw new Error('Invalid quote user');
  return normalized;
}

function normalizeQuoteCountry(value: unknown): Country {
  if (
    typeof value !== 'string' ||
    !SUPPORTED_COUNTRIES.some((supportedCountry) => supportedCountry === value)
  ) {
    throw new Error('Invalid quote country');
  }
  return value as Country;
}

function normalizeQuotePaymentMethod(value: unknown): PaymentMethod {
  if (value !== 'card' && value !== 'trade_credit') {
    throw new Error('Invalid quote payment method');
  }
  return value;
}

function normalizeQuoteTerms(value: unknown): CreditTerms | null {
  if (value === null) return null;
  if (value === 'net_30' || value === 30) return 'net_30';
  throw new Error('Invalid quote terms');
}

function normalizeQuoteTermsDays(value: unknown): 30 | null {
  if (value === null) return null;
  if (value === 30) return 30;
  throw new Error('Invalid quote terms days');
}

function assertMoney(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid ${name}`);
  }
}

function assertRate(value: unknown): asserts value is InvoiceVatRate {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw new Error('Invalid VAT rate');
  }
}

function normalizeQuoteMoney(value: unknown): number {
  assertMoney(value, 'quote amount');
  return value;
}

function normalizeQuoteRate(value: unknown): InvoiceVatRate {
  assertRate(value);
  return value;
}

function assertTerms(terms: unknown, termsDays: unknown): asserts terms is CreditTerms {
  if (terms !== 'net_30' && terms !== 30) {
    throw new Error('Trade-credit quote requires net-30 terms');
  }
  if (termsDays !== undefined && termsDays !== 30) {
    throw new Error('Trade-credit quote requires thirty-day terms');
  }
}

function resolveQuoteFacts(params: {
  cart: Cart;
  checkout: CheckoutQuoteCheckout;
  resolvedCountry: Country;
  accounting?: CheckoutQuoteFacts;
  topLevelAccounting?: CheckoutQuoteFacts;
  topLevelInvoiceTotals?: QuoteAccountingTotals;
  topLevelTotals?: QuoteAccountingTotals;
  topLevelPaymentMethod?: PaymentMethod;
  topLevelUserId?: number | string | null;
  topLevelCompanyId?: number | string | null;
  topLevelNetCents?: number;
  topLevelVatRateBasisPoints?: InvoiceVatRate;
  topLevelVatCents?: number;
  topLevelGrossCents?: number;
  topLevelTotalCents?: number;
  topLevelTerms?: CreditTerms | null;
  topLevelTermsDays?: 30 | null;
  topLevelPreparedAt?: string;
  baseTotalCents: number;
  deliveryChargeCents: number;
  discountCents: number;
}): {
  country: Country;
  paymentMethod: PaymentMethod;
  companyId: number | null;
  userId: number | null;
  netCents: number;
  vatRateBasisPoints: InvoiceVatRate;
  vatCents: number;
  grossCents: number;
  terms?: CreditTerms;
  termsDays?: 30;
  preparedAt?: string;
} {
  const checkout = params.checkout;
  const accounting = params.accounting;
  const topLevelAccounting = params.topLevelAccounting;
  const totalAliases: QuoteAccountingTotals[] = [
    checkout.accounting?.invoiceTotals,
    checkout.accounting?.totals,
    accounting?.invoiceTotals,
    accounting?.totals,
    topLevelAccounting?.invoiceTotals,
    topLevelAccounting?.totals,
    checkout.invoiceTotals,
    checkout.totals,
    params.topLevelInvoiceTotals,
    params.topLevelTotals,
  ].filter((value): value is QuoteAccountingTotals => value !== undefined);

  const country = resolveAlias(
    'country',
    [
      ['resolved country', params.resolvedCountry],
      ['checkout.country', checkout.country],
      ['checkout.accounting.country', checkout.accounting?.country],
      ['accounting.country', accounting?.country],
      ['top-level accounting.country', topLevelAccounting?.country],
    ],
    normalizeQuoteCountry,
  );
  if (country === undefined) throw new Error('Resolved checkout country is required');

  const paymentMethod =
    resolveAlias(
      'paymentMethod',
      [
        ['checkout.paymentMethod', checkout.paymentMethod],
        ['checkout.accounting.paymentMethod', checkout.accounting?.paymentMethod],
        ['accounting.paymentMethod', accounting?.paymentMethod],
        ['top-level paymentMethod', params.topLevelPaymentMethod],
        ['top-level accounting.paymentMethod', topLevelAccounting?.paymentMethod],
      ],
      normalizeQuotePaymentMethod,
    ) ?? ('card' as const);
  const companyId =
    resolveAlias(
      'quote company',
      [
        ['checkout.companyId', checkout.companyId],
        ['checkout.accounting.companyId', checkout.accounting?.companyId],
        ['accounting.companyId', accounting?.companyId],
        ['top-level companyId', params.topLevelCompanyId],
        ['top-level accounting.companyId', topLevelAccounting?.companyId],
      ],
      (value) => normalizePositiveId(value, 'quote company'),
    ) ?? null;
  const userId =
    resolveAlias(
      'quote user',
      [
        ['checkout.userId', checkout.userId],
        ['checkout.accounting.userId', checkout.accounting?.userId],
        ['accounting.userId', accounting?.userId],
        ['top-level userId', params.topLevelUserId],
        ['top-level accounting.userId', topLevelAccounting?.userId],
      ],
      normalizeQuoteUserId,
    ) ?? null;

  const suppliedNet = resolveAlias(
    'netCents',
    [
      ['checkout.netCents', checkout.netCents],
      ['checkout.accounting.netCents', checkout.accounting?.netCents],
      ['accounting.netCents', accounting?.netCents],
      ['top-level netCents', params.topLevelNetCents],
      ['top-level accounting.netCents', topLevelAccounting?.netCents],
      ...totalAliases.map(
        (totals, index) => [`totals[${index}].netCents`, totals.netCents] as const,
      ),
    ],
    normalizeQuoteMoney,
  );
  const suppliedVatRate = resolveAlias(
    'vatRateBasisPoints',
    [
      ['checkout.vatRateBasisPoints', checkout.vatRateBasisPoints],
      ['checkout.accounting.vatRateBasisPoints', checkout.accounting?.vatRateBasisPoints],
      ['accounting.vatRateBasisPoints', accounting?.vatRateBasisPoints],
      ['top-level vatRateBasisPoints', params.topLevelVatRateBasisPoints],
      ['top-level accounting.vatRateBasisPoints', topLevelAccounting?.vatRateBasisPoints],
      ...totalAliases.map(
        (totals, index) =>
          [`totals[${index}].vatRateBasisPoints`, totals.vatRateBasisPoints] as const,
      ),
    ],
    normalizeQuoteRate,
  );
  const suppliedVat = resolveAlias(
    'vatCents',
    [
      ['checkout.vatCents', checkout.vatCents],
      ['checkout.accounting.vatCents', checkout.accounting?.vatCents],
      ['accounting.vatCents', accounting?.vatCents],
      ['top-level vatCents', params.topLevelVatCents],
      ['top-level accounting.vatCents', topLevelAccounting?.vatCents],
      ...totalAliases.map(
        (totals, index) => [`totals[${index}].vatCents`, totals.vatCents] as const,
      ),
    ],
    normalizeQuoteMoney,
  );
  const suppliedGross = resolveAlias(
    'grossCents',
    [
      ['checkout.grossCents', checkout.grossCents],
      ['checkout.accounting.grossCents', checkout.accounting?.grossCents],
      ['accounting.grossCents', accounting?.grossCents],
      ['top-level grossCents', params.topLevelGrossCents],
      ['top-level accounting.grossCents', topLevelAccounting?.grossCents],
      ...totalAliases.map(
        (totals, index) => [`totals[${index}].grossCents`, totals.grossCents] as const,
      ),
    ],
    normalizeQuoteMoney,
  );
  const suppliedTotal = resolveAlias(
    'totalCents',
    [
      ['checkout.totalCents', checkout.totalCents],
      ['checkout.accounting.totalCents', checkout.accounting?.totalCents],
      ['accounting.totalCents', accounting?.totalCents],
      ['top-level totalCents', params.topLevelTotalCents],
      ['top-level accounting.totalCents', topLevelAccounting?.totalCents],
      ...totalAliases.map(
        (totals, index) => [`totals[${index}].totalCents`, totals.totalCents] as const,
      ),
    ],
    normalizeQuoteMoney,
  );
  const suppliedTerms = resolveAlias(
    'terms',
    [
      ['checkout.terms', checkout.terms],
      ['checkout.accounting.terms', checkout.accounting?.terms],
      ['accounting.terms', accounting?.terms],
      ['top-level terms', params.topLevelTerms],
      ['top-level accounting.terms', topLevelAccounting?.terms],
    ],
    normalizeQuoteTerms,
  );
  const suppliedTermsDays = resolveAlias(
    'termsDays',
    [
      ['checkout.termsDays', checkout.termsDays],
      ['checkout.accounting.termsDays', checkout.accounting?.termsDays],
      ['accounting.termsDays', accounting?.termsDays],
      ['top-level termsDays', params.topLevelTermsDays],
      ['top-level accounting.termsDays', topLevelAccounting?.termsDays],
    ],
    normalizeQuoteTermsDays,
  );
  const preparedAt = resolveAlias(
    'preparedAt',
    [
      ['checkout.preparedAt', checkout.preparedAt],
      ['checkout.accounting.preparedAt', checkout.accounting?.preparedAt],
      ['accounting.preparedAt', accounting?.preparedAt],
      ['top-level preparedAt', params.topLevelPreparedAt],
      ['top-level accounting.preparedAt', topLevelAccounting?.preparedAt],
    ],
    (value) => {
      if (typeof value !== 'string') throw new Error('Invalid preparedAt');
      return value;
    },
  );

  if (paymentMethod === 'card') {
    if (companyId !== null) throw new Error('Card quote cannot carry a company');
    if (suppliedTerms !== undefined && suppliedTerms !== null) {
      throw new Error('Card quote cannot carry trade-credit terms');
    }
    if (suppliedTermsDays !== undefined && suppliedTermsDays !== null) {
      throw new Error('Card quote cannot carry trade-credit terms');
    }
    if (suppliedNet !== undefined && suppliedNet !== params.baseTotalCents) {
      throw new Error('Card quote net does not match checkout total');
    }
    if (suppliedVatRate !== undefined && suppliedVatRate !== 0) {
      throw new Error('Card quote VAT must be zero');
    }
    if (suppliedVat !== undefined && suppliedVat !== 0) {
      throw new Error('Card quote VAT must be zero');
    }
    if (suppliedGross !== undefined && suppliedGross !== params.baseTotalCents) {
      throw new Error('Card quote gross does not match checkout total');
    }
    if (suppliedTotal !== undefined && suppliedTotal !== params.baseTotalCents) {
      throw new Error('Card quote total does not match checkout total');
    }
    return {
      country,
      paymentMethod,
      companyId: null,
      userId,
      netCents: params.baseTotalCents,
      vatRateBasisPoints: 0,
      vatCents: 0,
      grossCents: params.baseTotalCents,
      ...(preparedAt === undefined ? {} : { preparedAt }),
    };
  }

  if (companyId === null) throw new Error('Trade-credit quote requires a company');
  if (userId === null) throw new Error('Trade-credit quote requires an authenticated user');
  if (suppliedTerms === null) {
    throw new Error('Trade-credit quote requires non-null net-30 terms');
  }
  if (suppliedTermsDays === null) {
    throw new Error('Trade-credit quote requires thirty-day terms');
  }
  const terms = suppliedTerms ?? 'net_30';
  assertTerms(terms, suppliedTermsDays);
  const profileRate = countryProfile(country).vatRateBasisPoints;
  const vatRateBasisPoints = suppliedVatRate ?? profileRate;
  assertRate(vatRateBasisPoints);
  if (vatRateBasisPoints !== profileRate) {
    throw new Error('Trade-credit quote VAT rate does not match country profile');
  }
  // Invoice totals are derived from canonical GBP-pence cart facts. Supplied tuples are accepted
  // only as a checked server hand-off; they cannot override merchandise, discount, delivery, or
  // the country-owned VAT rate.
  const calculated = calculateInvoiceTotals({
    merchandiseCents: params.cart.subtotalCents,
    promoDiscountCents: params.discountCents,
    deliveryCents: params.deliveryChargeCents,
    vatRateBasisPoints,
  });
  for (const [name, supplied, expected] of [
    ['netCents', suppliedNet, calculated.netCents],
    ['vatCents', suppliedVat, calculated.vatCents],
    ['grossCents', suppliedGross, calculated.grossCents],
    ['totalCents', suppliedTotal, calculated.grossCents],
  ] as const) {
    if (supplied !== undefined) {
      assertMoney(supplied, name);
      if (supplied !== expected)
        throw new Error(`Trade-credit quote ${name} does not match totals`);
    }
  }
  return {
    country,
    paymentMethod,
    companyId,
    userId,
    ...calculated,
    vatRateBasisPoints,
    terms,
    ...(suppliedTermsDays === undefined ? {} : { termsDays: 30 as const }),
    ...(preparedAt === undefined ? {} : { preparedAt }),
  };
}

/** Maps cart data once into an immutable, persistence-safe checkout quote. */
export function createCheckoutQuote(params: {
  cart: Cart;
  checkout: CheckoutQuoteCheckout;
  /** Server-resolved destination, billing party, slot, and buyer reference. */
  resolved: ResolvedCheckoutCommitments;
  promo: ValidPromo | undefined;
  createdAt: string;
  inventoryAllocations: readonly InventoryReservationAllocation[];
  /** Identity and payment facts resolved by the checkout workflow. */
  country: Country;
  paymentMethod?: PaymentMethod;
  userId?: number | string | null;
  companyId?: number | string | null;
  netCents?: number;
  vatRateBasisPoints?: InvoiceVatRate;
  vatCents?: number;
  grossCents?: number;
  totalCents?: number;
  terms?: CreditTerms | null;
  termsDays?: 30 | null;
  preparedAt?: string;
  invoiceTotals?: QuoteAccountingTotals;
  accounting?: CheckoutQuoteFacts;
  totals?: QuoteAccountingTotals;
}): PersistedCheckoutQuote {
  const promoScope = params.promo
    ? resolvePromoScope({ promo: params.promo, cart: params.cart })
    : undefined;
  const discountCents = params.promo
    ? calculateDiscount({
        promo: params.promo,
        discountableSubtotalCents: promoScope!.discountBaseCents,
      })
    : 0;

  const variantLines: PersistedCheckoutQuoteV10['variantLines'] = params.cart.items.map((item) => {
    const snap = item.variantSnap;
    if (!snap || snap.sku.trim() === '') {
      throw new Error('Checkout quote line is missing an immutable SKU');
    }
    const line = {
      productId: item.productId,
      variantId: snap?.variantId ?? 0,
      productName: item.product.name,
      variantLabel: snap?.label ?? item.product.name,
      sku: snap.sku,
      unitPriceCents: resolvedLineUnitPrice(item),
      weightGrams: snap?.weightGrams ?? 1000,
      deliveryClass: snap?.deliveryClass ?? 'parcel',
      quantity: item.quantity,
      lineTotalCents: item.lineTotalCents,
      consumptionClassification: item.product.consumptionClassification ?? 'non-food',
    };
    // V10 freezes the SKU on every line. Plain lines still omit the configured-only money split
    // and specification so their pricing shape stays unchanged apart from this identity fact.
    if (!item.customBlend) return line;
    return {
      ...line,
      materialSubtotalCents: item.materialSubtotalCents,
      blendingFeeCents: item.blendingFeeCents,
      discountableTotalCents: item.discountableTotalCents,
      customBlend: item.customBlend,
    };
  });

  const deliverySummary = quoteCartDelivery(params.cart);
  const baseTotalCents = params.cart.subtotalCents - discountCents + deliverySummary.chargeCents;
  const checkout = params.checkout;
  const facts = resolveQuoteFacts({
    cart: params.cart,
    checkout,
    resolvedCountry: params.country,
    accounting: params.accounting,
    topLevelAccounting: checkout.accounting,
    topLevelInvoiceTotals: params.invoiceTotals,
    topLevelTotals: params.totals,
    topLevelPaymentMethod: params.paymentMethod,
    topLevelUserId: params.userId,
    topLevelCompanyId: params.companyId,
    topLevelNetCents: params.netCents,
    topLevelVatRateBasisPoints: params.vatRateBasisPoints,
    topLevelVatCents: params.vatCents,
    topLevelGrossCents: params.grossCents,
    topLevelTotalCents: params.totalCents,
    topLevelTerms: params.terms,
    topLevelTermsDays: params.termsDays,
    topLevelPreparedAt: params.preparedAt,
    baseTotalCents,
    deliveryChargeCents: deliverySummary.chargeCents,
    discountCents,
  });

  const quote: PersistedCheckoutQuoteV10 = {
    version: CURRENT_PERSISTED_CHECKOUT_QUOTE_VERSION,
    cartId: params.cart.id,
    customer: {
      name: checkout.customerName.trim(),
      email: checkout.customerEmail.trim().toLowerCase(),
      deliveryAddress: params.resolved.deliveryAddress,
      // The legacy free-text address is rendered here and nowhere else, so the structured value
      // and the flat `orders.shipping_address` column can never disagree.
      shippingAddress: formatPostalAddress(params.resolved.deliveryAddress),
    },
    userId: facts.userId,
    // Only the validated server promo reaches the immutable quote; a raw checkout code is not a
    // pricing fact and must not be allowed to diverge from the applied discount.
    promoCode: params.promo?.code ?? null,
    subtotalCents: params.cart.subtotalCents,
    discountBaseCents: promoScope?.discountBaseCents ?? 0,
    promoCategoryScope: params.promo?.categoryScope ?? null,
    discountCents,
    totalCents: facts.grossCents,
    lines: [],
    variantLines,
    deliverySummary,
    inventoryAllocations: params.inventoryAllocations.map((allocation) => ({
      productId: String(allocation.variantId),
      reservedQuantity: allocation.reservedQuantity,
      backorderedQuantity: allocation.backorderedQuantity,
    })),
    billingEntity: params.resolved.billingEntity,
    deliverySlot: params.resolved.deliverySlot,
    purchaseOrderReference: params.resolved.purchaseOrderReference,
    createdAt: params.createdAt,
    country: facts.country,
    paymentMethod: facts.paymentMethod,
    companyId: facts.companyId === null ? null : String(facts.companyId),
    netCents: facts.netCents,
    vatRateBasisPoints: facts.vatRateBasisPoints,
    vatCents: facts.vatCents,
    grossCents: facts.grossCents,
    ...(facts.terms === undefined ? {} : { terms: facts.terms }),
    ...(facts.termsDays === undefined ? {} : { termsDays: facts.termsDays }),
    ...(facts.preparedAt === undefined ? {} : { preparedAt: facts.preparedAt }),
  };
  // Validate at the quote boundary so malformed conditional rows can never reach persistence or
  // a later finalizer. The contract parser also enforces V9 configured-line integrity.
  return parseContractPersistedCheckoutQuote(quote);
}

/**
 * Unit price comes from the material subtotal, never the line total: a blending fee is charged
 * once per configured line, so dividing the line total by quantity would smear it across sacks.
 */
function resolvedLineUnitPrice(item: Cart['items'][number]): number {
  const { materialSubtotalCents, blendingFeeCents, lineTotalCents, quantity } = item;
  if (
    !Number.isSafeInteger(materialSubtotalCents) ||
    !Number.isSafeInteger(blendingFeeCents) ||
    !Number.isSafeInteger(lineTotalCents) ||
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    materialSubtotalCents < 0 ||
    blendingFeeCents < 0 ||
    materialSubtotalCents % quantity !== 0 ||
    materialSubtotalCents + blendingFeeCents !== lineTotalCents ||
    materialSubtotalCents !== item.resolvedUnitPriceCents * quantity
  ) {
    throw new Error('Cart line has an invalid resolved price.');
  }
  return materialSubtotalCents / quantity;
}
