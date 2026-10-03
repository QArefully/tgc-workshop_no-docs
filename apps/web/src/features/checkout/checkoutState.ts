import type { DeliverySlot } from '@shop/contracts/delivery';
import type { PaymentMethod } from '@shop/contracts/payments';
import type { PromoValidationErrorCode } from '@shop/contracts/promos';
import type { PublicErrorCode } from '@shop/contracts/public-errors';
import type {
  CreditAccountMemberResponse,
  CreditAccountMemberView,
} from '@shop/contracts/trade-credit';
import type { ApiErrorMeta } from '@/api/client';
import type { MessageParams } from '@shop/localisation';
import { checkoutMessages } from '@shop/localisation/messages/checkout';
import {
  EMPTY_POSTAL_ADDRESS_DRAFT,
  type PostalAddressDraft,
} from '@/features/account/PostalAddressFields';

export type ContactField = 'customerName' | 'customerEmail';
export type DeliveryField = 'deliverySiteId';
export type ScheduleField = 'deliverySlot';
export type BillingField =
  | 'billingEntityId'
  | 'billingLegalName'
  | 'billingRegistrationNumber'
  | 'billingVatNumber'
  | 'purchaseOrderReference';
export type CardField = 'cardNumber' | 'cardExpiry' | 'cardCvc';
export type Field = ContactField | DeliveryField | ScheduleField | BillingField | CardField;
export type FieldErrors = Partial<Record<Field, string>>;

/** Payment method selected for this checkout intent. */
export type CheckoutPaymentMethod = PaymentMethod;

/** Credit summary lifecycle; `unavailable` is a safe no-account/non-active outcome, not an error. */
export type CreditSummaryStatus = 'idle' | 'loading' | 'loaded' | 'error' | 'unavailable';

/** Stable checkout failure identity. Copy resolves at render time for active country. */
export type CheckoutMessageKey = keyof typeof checkoutMessages;
export type CheckoutErrorState = {
  readonly code: PublicErrorCode | null;
  readonly meta: ApiErrorMeta | null;
  readonly key: CheckoutMessageKey;
  readonly params?: MessageParams;
};

/**
 * Whether a destination or billing party is a stored trade record or entered for this order only.
 * Mirrors the `kind` discriminator of the `PaymentBody` unions so step state maps to transport
 * without inventing a second vocabulary.
 */
export type SelectionKind = 'saved' | 'adhoc';

/** Step 1 state: who is buying and where the consignment goes. */
export type CheckoutDelivery = {
  destinationKind: SelectionKind;
  /** Empty string while no saved site is chosen. */
  deliverySiteId: string;
  address: PostalAddressDraft;
  /**
   * Set once this state has been reconciled with the saved-site list. Guards the one-shot default
   * preselection so a later list reload can never overwrite the buyer's own choice.
   */
  initialized: boolean;
};

/** Step 2 scheduling state. The slot is always one the server offered; never derived locally. */
export type CheckoutSchedule = {
  slot: DeliverySlot | null;
};

/** Step 2 billing state, including the optional buyer reference carried onto the order. */
export type CheckoutBilling = {
  selectionKind: SelectionKind;
  billingEntityId: string;
  legalName: string;
  registrationNumber: string;
  vatNumber: string;
  address: PostalAddressDraft;
  purchaseOrderReference: string;
  initialized: boolean;
};

export type CheckoutConflict =
  | { code: 'RESERVATION_EXPIRED'; reservationExpiresAt: string }
  | { code: 'INSUFFICIENT_STOCK'; productIds: string[] }
  | { code: 'DELIVERY_SLOT_UNAVAILABLE'; earliestDate: string }
  | { code: 'PENDING_APPROVAL'; approvalRequestId: string }
  | { code: 'APPROVAL_REJECTED' }
  | { code: 'APPROVAL_EXPIRED' }
  | { code: 'APPROVAL_TOTAL_DRIFT' }
  | { code: 'DELIVERY_COUNTRY_NOT_ALLOWED' };

export const DELIVERY_COUNTRY_NOT_ALLOWED_MESSAGE =
  'Your account cannot deliver to the selected country. Choose an available delivery country before retrying.';

export type CheckoutState = {
  contact: Record<ContactField, string>;
  delivery: CheckoutDelivery;
  schedule: CheckoutSchedule;
  billing: CheckoutBilling;
  card: Record<CardField, string>;
  paymentMethod: CheckoutPaymentMethod;
  /** Server-owned member summary; never a client-derived balance or company projection. */
  creditSummary: CreditAccountMemberView | null;
  creditSummaryStatus: CreditSummaryStatus;
  creditSummaryError: string | null;
  creditSummaryErrorState: CheckoutErrorState | null;
  creditSummaryUnavailable: boolean;
  /** Checkout identity that produced the current credit lifecycle state. */
  creditSummaryIdentity: string | null;
  /** Internal request identity used to make reducer events stale-safe in addition to hook guards. */
  creditSummaryRequestId: string | null;
  touched: Partial<Record<Field, boolean>>;
  promoCode: string;
  appliedPromo: string | null;
  appliedPromoQuoteKey: string | null;
  discountCents: number;
  discountBaseCents: number | null;
  promoCategoryScope: string | null;
  promoTotalCents: number | null;
  promoError: string | null;
  promoErrorState: CheckoutErrorState | null;
  promoErrorCode: PromoValidationErrorCode | null;
  promoMinSubtotalCents: number | null;
  promoValidating: boolean;
  submitting: boolean;
  paymentError: string | null;
  paymentErrorState: CheckoutErrorState | null;
  idempotencyKey: string;
  cartRecoveryMessage: string | null;
  conflict: CheckoutConflict | null;
};

export type CheckoutEvent =
  | { type: 'contact-changed'; field: ContactField; value: string; idempotencyKey: string }
  | { type: 'delivery-changed'; patch: Partial<CheckoutDelivery>; idempotencyKey: string }
  | { type: 'schedule-changed'; slot: DeliverySlot | null; idempotencyKey: string }
  | { type: 'billing-changed'; patch: Partial<CheckoutBilling>; idempotencyKey: string }
  | {
      type: 'billing-prefilled';
      patch: Pick<CheckoutBilling, 'legalName' | 'address'>;
      idempotencyKey: string;
    }
  | { type: 'delivery-sites-loaded'; defaultSiteId: string | null; idempotencyKey: string }
  | { type: 'billing-entities-loaded'; defaultEntityId: string | null; idempotencyKey: string }
  | { type: 'card-changed'; field: CardField; value: string; idempotencyKey: string }
  | {
      type: 'payment-method-changed';
      paymentMethod: CheckoutPaymentMethod;
      idempotencyKey: string;
    }
  | {
      type: 'payment-method-selected';
      paymentMethod: CheckoutPaymentMethod;
      idempotencyKey: string;
    }
  | { type: 'checkout-identity-changed'; idempotencyKey: string }
  | { type: 'credit-summary-loading'; requestId?: string; creditIdentity?: string }
  | {
      type: 'credit-summary-loaded';
      requestId?: string;
      creditIdentity?: string;
      summary: CreditAccountMemberResponse;
    }
  | {
      type: 'credit-summary-failed';
      requestId?: string;
      creditIdentity?: string;
      error?: string;
      errorState?: CheckoutErrorState;
    }
  | { type: 'credit-summary-unavailable'; requestId?: string; creditIdentity?: string }
  | { type: 'field-touched'; field: Field }
  | { type: 'fields-touched'; fields: Field[] }
  | { type: 'promo-changed'; value: string; idempotencyKey: string }
  | { type: 'promo-started' }
  | {
      type: 'promo-applied';
      promoCode: string;
      quoteKey: string;
      discountCents: number;
      discountBaseCents: number | null;
      promoCategoryScope: string | null;
      totalCents: number;
    }
  | {
      type: 'promo-failed';
      error?: string;
      errorState?: CheckoutErrorState;
      errorCode: PromoValidationErrorCode | null;
      minSubtotalCents?: number | null;
    }
  | { type: 'promo-removed'; idempotencyKey: string }
  | { type: 'quote-changed'; idempotencyKey: string }
  | { type: 'cart-recovered'; message: string }
  | { type: 'conflict'; conflict: CheckoutConflict; idempotencyKey: string }
  | { type: 'submission-started' }
  | { type: 'submission-failed'; error?: string; errorState?: CheckoutErrorState }
  | { type: 'submission-finished' };

export const contactFields: ContactField[] = ['customerName', 'customerEmail'];
export const deliveryFields: DeliveryField[] = ['deliverySiteId'];
export const scheduleFields: ScheduleField[] = ['deliverySlot'];
export const billingFields: BillingField[] = [
  'billingEntityId',
  'billingLegalName',
  'billingRegistrationNumber',
  'billingVatNumber',
  'purchaseOrderReference',
];
export const cardFields: CardField[] = ['cardNumber', 'cardExpiry', 'cardCvc'];
export const paymentMethods: CheckoutPaymentMethod[] = ['card', 'trade_credit'];

/** Fields validated before the delivery step may be left. */
export const deliveryStepFields: Field[] = [...contactFields, ...deliveryFields];
/** Fields validated before the schedule and billing step may be left. */
export const scheduleStepFields: Field[] = [...scheduleFields, ...billingFields];

export function createIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function initialCheckoutState(): CheckoutState {
  return {
    contact: { customerName: '', customerEmail: '' },
    delivery: {
      destinationKind: 'adhoc',
      deliverySiteId: '',
      address: { ...EMPTY_POSTAL_ADDRESS_DRAFT },
      initialized: false,
    },
    schedule: { slot: null },
    billing: {
      selectionKind: 'adhoc',
      billingEntityId: '',
      legalName: '',
      registrationNumber: '',
      vatNumber: '',
      address: { ...EMPTY_POSTAL_ADDRESS_DRAFT },
      purchaseOrderReference: '',
      initialized: false,
    },
    card: { cardNumber: '', cardExpiry: '', cardCvc: '' },
    paymentMethod: 'card',
    creditSummary: null,
    creditSummaryStatus: 'idle',
    creditSummaryError: null,
    creditSummaryErrorState: null,
    creditSummaryUnavailable: false,
    creditSummaryIdentity: null,
    creditSummaryRequestId: null,
    touched: {},
    promoCode: '',
    appliedPromo: null,
    appliedPromoQuoteKey: null,
    discountCents: 0,
    discountBaseCents: null,
    promoCategoryScope: null,
    promoTotalCents: null,
    promoError: null,
    promoErrorState: null,
    promoErrorCode: null,
    promoMinSubtotalCents: null,
    promoValidating: false,
    submitting: false,
    paymentError: null,
    paymentErrorState: null,
    idempotencyKey: createIdempotencyKey(),
    cartRecoveryMessage: null,
    conflict: null,
  };
}

const EMPTY_CARD = { cardNumber: '', cardExpiry: '', cardCvc: '' } as const;

function withoutCardTouches(
  touched: Partial<Record<Field, boolean>>,
): Partial<Record<Field, boolean>> {
  const next = { ...touched };
  for (const field of cardFields) delete next[field];
  return next;
}

function clearCreditSummary(): Pick<
  CheckoutState,
  | 'creditSummary'
  | 'creditSummaryStatus'
  | 'creditSummaryError'
  | 'creditSummaryErrorState'
  | 'creditSummaryUnavailable'
  | 'creditSummaryIdentity'
  | 'creditSummaryRequestId'
> {
  return {
    creditSummary: null,
    creditSummaryStatus: 'idle',
    creditSummaryError: null,
    creditSummaryErrorState: null,
    creditSummaryUnavailable: false,
    creditSummaryIdentity: null,
    creditSummaryRequestId: null,
  };
}

function creditEventIsCurrent(state: CheckoutState, requestId?: string): boolean {
  return requestId === undefined || requestId === state.creditSummaryRequestId;
}

function billingDraftIsEmpty(billing: CheckoutBilling): boolean {
  return (
    billing.selectionKind === 'adhoc' &&
    billing.billingEntityId === '' &&
    billing.legalName === '' &&
    billing.registrationNumber === '' &&
    billing.vatNumber === '' &&
    billing.purchaseOrderReference === '' &&
    billing.address.line1 === '' &&
    billing.address.line2 === '' &&
    billing.address.city === '' &&
    billing.address.region === '' &&
    billing.address.postcode === ''
  );
}

/**
 * Reducer for the three-step checkout.
 *
 * Every event that changes a value the backend fingerprints — contact, destination, slot, billing
 * party, purchase-order reference, card, promo — carries a fresh idempotency key. Reusing a key
 * under a changed payload is exactly what the API answers with `IDEMPOTENT_CONFLICT`, so key
 * rotation is a property of the state transition rather than of the submit path.
 */
export function checkoutReducer(state: CheckoutState, event: CheckoutEvent): CheckoutState {
  switch (event.type) {
    case 'contact-changed':
      return {
        ...state,
        contact: { ...state.contact, [event.field]: event.value },
        paymentError: null,
        paymentErrorState: null,
        submitting: false,
        idempotencyKey: event.idempotencyKey,
      };
    case 'delivery-changed':
      return {
        ...state,
        delivery: { ...state.delivery, ...event.patch, initialized: true },
        paymentError: null,
        paymentErrorState: null,
        submitting: false,
        idempotencyKey: event.idempotencyKey,
      };
    case 'schedule-changed':
      return {
        ...state,
        schedule: { slot: event.slot },
        // A newly chosen slot supersedes a slot-unavailable rejection; other conflicts stand.
        conflict: state.conflict?.code === 'DELIVERY_SLOT_UNAVAILABLE' ? null : state.conflict,
        paymentError: null,
        paymentErrorState: null,
        submitting: false,
        idempotencyKey: event.idempotencyKey,
      };
    case 'billing-changed':
      return {
        ...state,
        billing: { ...state.billing, ...event.patch, initialized: true },
        paymentError: null,
        paymentErrorState: null,
        submitting: false,
        idempotencyKey: event.idempotencyKey,
      };
    case 'billing-prefilled':
      // Do not replace an entered draft; retaining `initialized` lets a later saved default win.
      if (!billingDraftIsEmpty(state.billing)) return state;
      return {
        ...state,
        billing: { ...state.billing, ...event.patch },
        paymentError: null,
        paymentErrorState: null,
        submitting: false,
        idempotencyKey: event.idempotencyKey,
      };
    case 'delivery-sites-loaded': {
      if (state.delivery.initialized) return state;
      return {
        ...state,
        delivery: {
          ...state.delivery,
          initialized: true,
          ...(event.defaultSiteId === null
            ? {}
            : { destinationKind: 'saved' as const, deliverySiteId: event.defaultSiteId }),
        },
        submitting: false,
        idempotencyKey: event.idempotencyKey,
      };
    }
    case 'billing-entities-loaded': {
      if (state.billing.initialized) return state;
      return {
        ...state,
        billing: {
          ...state.billing,
          initialized: true,
          ...(event.defaultEntityId === null
            ? {}
            : { selectionKind: 'saved' as const, billingEntityId: event.defaultEntityId }),
        },
        submitting: false,
        idempotencyKey: event.idempotencyKey,
      };
    }
    case 'card-changed':
      // A trade-credit checkout has no card form. Ignore any stale/UI event and make the safe
      // invariant explicit so a card secret can never remain attached to that method.
      if (state.paymentMethod === 'trade_credit') {
        return {
          ...state,
          card: { ...EMPTY_CARD },
          touched: withoutCardTouches(state.touched),
        };
      }
      return {
        ...state,
        card: { ...state.card, [event.field]: event.value },
        paymentError: null,
        paymentErrorState: null,
        submitting: false,
        idempotencyKey: event.idempotencyKey,
      };
    case 'payment-method-changed':
    case 'payment-method-selected': {
      if (event.paymentMethod === state.paymentMethod) return state;
      const card = event.paymentMethod === 'trade_credit' ? { ...EMPTY_CARD } : state.card;
      return {
        ...state,
        paymentMethod: event.paymentMethod,
        card,
        touched:
          event.paymentMethod === 'trade_credit'
            ? withoutCardTouches(state.touched)
            : state.touched,
        ...clearCreditSummary(),
        paymentError: null,
        paymentErrorState: null,
        conflict: null,
        submitting: false,
        idempotencyKey: event.idempotencyKey,
      };
    }
    case 'checkout-identity-changed':
      return {
        ...state,
        ...clearCreditSummary(),
        paymentError: null,
        paymentErrorState: null,
        conflict: null,
        submitting: false,
        idempotencyKey: event.idempotencyKey,
      };
    case 'credit-summary-loading':
      return {
        ...state,
        creditSummary: null,
        creditSummaryStatus: 'loading',
        creditSummaryError: null,
        creditSummaryErrorState: null,
        creditSummaryUnavailable: false,
        creditSummaryIdentity: event.creditIdentity ?? state.creditSummaryIdentity,
        creditSummaryRequestId: event.requestId ?? state.creditSummaryRequestId,
      };
    case 'credit-summary-loaded':
      if (!creditEventIsCurrent(state, event.requestId)) return state;
      return {
        ...state,
        creditSummary: event.summary,
        creditSummaryStatus:
          event.summary !== null && event.summary.state === 'active' ? 'loaded' : 'unavailable',
        creditSummaryError: null,
        creditSummaryErrorState: null,
        creditSummaryUnavailable: event.summary === null || event.summary.state !== 'active',
        creditSummaryIdentity: event.creditIdentity ?? state.creditSummaryIdentity,
      };
    case 'credit-summary-unavailable':
      if (!creditEventIsCurrent(state, event.requestId)) return state;
      return {
        ...state,
        creditSummary: null,
        creditSummaryStatus: 'unavailable',
        creditSummaryError: null,
        creditSummaryErrorState: null,
        creditSummaryUnavailable: true,
        creditSummaryIdentity: event.creditIdentity ?? state.creditSummaryIdentity,
      };
    case 'credit-summary-failed':
      if (!creditEventIsCurrent(state, event.requestId)) return state;
      return {
        ...state,
        creditSummary: null,
        creditSummaryStatus: 'error',
        creditSummaryError: event.error ?? event.errorState?.code ?? event.errorState?.key ?? null,
        creditSummaryErrorState: event.errorState ?? null,
        creditSummaryUnavailable: false,
        creditSummaryIdentity: event.creditIdentity ?? state.creditSummaryIdentity,
      };
    case 'field-touched':
      if (state.paymentMethod === 'trade_credit' && cardFields.includes(event.field as CardField))
        return state;
      return { ...state, touched: { ...state.touched, [event.field]: true } };
    case 'fields-touched':
      return {
        ...state,
        touched: {
          ...state.touched,
          ...Object.fromEntries(
            event.fields
              .filter(
                (field) =>
                  state.paymentMethod !== 'trade_credit' ||
                  !cardFields.includes(field as CardField),
              )
              .map((field) => [field, true]),
          ),
        },
      };
    case 'promo-changed':
      return {
        ...state,
        promoCode: event.value,
        promoError: null,
        promoErrorState: null,
        promoErrorCode: null,
        promoMinSubtotalCents: null,
        promoValidating: false,
        paymentError: null,
        paymentErrorState: null,
        submitting: false,
        idempotencyKey: event.idempotencyKey,
      };
    case 'promo-started':
      return {
        ...state,
        promoValidating: true,
        promoError: null,
        promoErrorState: null,
        promoErrorCode: null,
        promoMinSubtotalCents: null,
      };
    case 'promo-applied':
      return {
        ...state,
        promoValidating: false,
        promoError: null,
        promoErrorState: null,
        promoErrorCode: null,
        promoMinSubtotalCents: null,
        appliedPromo: event.promoCode,
        appliedPromoQuoteKey: event.quoteKey,
        discountCents: event.discountCents,
        discountBaseCents: event.discountBaseCents,
        promoCategoryScope: event.promoCategoryScope,
        promoTotalCents: event.totalCents,
      };
    case 'promo-failed':
      return {
        ...state,
        promoValidating: false,
        promoError: event.error ?? event.errorState?.code ?? event.errorState?.key ?? null,
        promoErrorState: event.errorState ?? null,
        promoErrorCode: event.errorCode,
        promoMinSubtotalCents: event.minSubtotalCents ?? null,
      };
    case 'promo-removed':
      return {
        ...state,
        promoCode: '',
        appliedPromo: null,
        appliedPromoQuoteKey: null,
        discountCents: 0,
        discountBaseCents: null,
        promoCategoryScope: null,
        promoTotalCents: null,
        promoError: null,
        promoErrorState: null,
        promoErrorCode: null,
        promoMinSubtotalCents: null,
        idempotencyKey: event.idempotencyKey,
        submitting: false,
      };
    case 'quote-changed':
      return {
        ...state,
        ...clearCreditSummary(),
        appliedPromo: null,
        appliedPromoQuoteKey: null,
        discountCents: 0,
        discountBaseCents: null,
        promoCategoryScope: null,
        promoTotalCents: null,
        promoError: null,
        promoErrorState: null,
        promoErrorCode: null,
        promoMinSubtotalCents: null,
        promoValidating: false,
        conflict: null,
        submitting: false,
        paymentError: null,
        paymentErrorState: null,
        idempotencyKey: event.idempotencyKey,
      };
    case 'cart-recovered':
      return { ...state, cartRecoveryMessage: event.message };
    case 'conflict':
      return {
        ...state,
        conflict: event.conflict,
        paymentError:
          event.conflict.code === 'DELIVERY_COUNTRY_NOT_ALLOWED' ? event.conflict.code : null,
        paymentErrorState:
          event.conflict.code === 'DELIVERY_COUNTRY_NOT_ALLOWED'
            ? {
                code: 'DELIVERY_COUNTRY_NOT_ALLOWED',
                meta: null,
                key: 'checkout.error.deliveryCountry',
              }
            : null,
        submitting: false,
        idempotencyKey: event.idempotencyKey,
      };
    case 'submission-started':
      return { ...state, submitting: true, paymentError: null, paymentErrorState: null };
    case 'submission-failed':
      return {
        ...state,
        paymentError: event.error ?? event.errorState?.code ?? event.errorState?.key ?? null,
        paymentErrorState: event.errorState ?? null,
      };
    case 'submission-finished':
      return { ...state, submitting: false };
  }
}

type QuoteItem = {
  productId: string;
  quantity: number;
  lineTotalCents: number;
  configKey?: string;
  variantSnap?: { variantId?: number };
  sku?: string;
  resolvedUnitPriceCents?: number;
  materialSubtotalCents?: number;
  blendingFeeCents?: number;
  discountableTotalCents?: number;
};
type QuoteCart = {
  id: string;
  subtotalCents: number;
  items: QuoteItem[];
};

/** Stable against rendering and cart-item ordering. */
export function createCartQuoteKey(cart: QuoteCart | null): string | null {
  if (!cart) return null;
  const lines = [...cart.items]
    .sort((left, right) => {
      const leftKey = `${left.productId}:${left.variantSnap?.variantId ?? ''}:${left.configKey ?? ''}`;
      const rightKey = `${right.productId}:${right.variantSnap?.variantId ?? ''}:${right.configKey ?? ''}`;
      return leftKey.localeCompare(rightKey);
    })
    .map((item) =>
      JSON.stringify([
        item.productId,
        item.variantSnap?.variantId ?? null,
        item.sku ?? null,
        item.configKey ?? '',
        item.quantity,
        item.resolvedUnitPriceCents ?? null,
        item.materialSubtotalCents ?? null,
        item.blendingFeeCents ?? null,
        item.discountableTotalCents ?? null,
        item.lineTotalCents,
      ]),
    );
  return `${cart.id}:${cart.subtotalCents}:${lines.join('|')}`;
}

/** Stable identity of a slot, used for radio values and offered-list membership checks. */
export function slotKey(slot: DeliverySlot): string {
  return `${slot.date}:${slot.window}`;
}

export function selectAppliedPromo(state: CheckoutState, quoteKey: string | null): string | null {
  return state.appliedPromoQuoteKey === quoteKey ? state.appliedPromo : null;
}

export function selectDiscountCents(state: CheckoutState, quoteKey: string | null): number {
  return state.appliedPromoQuoteKey === quoteKey ? state.discountCents : 0;
}
