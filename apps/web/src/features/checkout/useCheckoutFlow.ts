import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { DeliverySlot } from '@shop/contracts/delivery';
import { useCartContext } from '@/hooks/CartContext';
import { useAuth } from '@/hooks/AuthContext';
import { useOptionalCountry } from '@/hooks/CountryContext';
import { useLocalisation } from '@/i18n/LocaleContext';
import { checkoutMessages } from '@shop/localisation/messages/checkout';
import { useTradeProfile } from '@/features/account/useTradeProfile';
import { toPostalAddressDraft } from '@/features/account/PostalAddressFields';
import { getTradeCreditSummary } from '@/api/tradeCredit';
import { ApiError } from '@/api/client';
import type { CreditAccountMemberResponse } from '@shop/contracts/trade-credit';
import { isEligibleForPromo } from './cartValidation';
import {
  cardFields,
  checkoutReducer,
  contactFields,
  createCartQuoteKey,
  createIdempotencyKey,
  deliveryStepFields,
  initialCheckoutState,
  paymentMethods,
  scheduleStepFields,
  selectAppliedPromo,
  selectDiscountCents,
  type CheckoutBilling,
  type CheckoutDelivery,
  type CheckoutErrorState,
  type CreditSummaryStatus,
  type Field,
} from './checkoutState';
import {
  buildBillingSelection,
  buildDeliveryDestination,
  validateBilling,
  validateCard,
  validateContact,
  validateDelivery,
  validateSchedule,
} from './checkoutValidation';
import { useCheckoutNavigation } from './useCheckoutNavigation';
import { useDeliverySlots } from './useDeliverySlots';
import { usePaymentSubmission } from './usePaymentSubmission';
import { usePromoQuote } from './usePromoQuote';
import { checkoutErrorState, localizeCheckoutError } from './checkoutCopy';

function isAbort(error: unknown): boolean {
  return (
    (typeof DOMException !== 'undefined' &&
      error instanceof DOMException &&
      error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

/** Missing membership/auth is an expected unavailable outcome, not a load failure. */
function creditResponseMeansUnavailable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status === 401 || error.status === 403 || error.status === 404) return true;
  return (
    error.code === 'AUTH_REQUIRED' ||
    error.code === 'UNAUTHORIZED' ||
    error.code === 'FORBIDDEN' ||
    error.code === 'NO_ACTIVE_MEMBERSHIP' ||
    error.code === 'CREDIT_ACCOUNT_NOT_FOUND' ||
    error.code === 'CREDIT_ACCOUNT_FORBIDDEN' ||
    error.code === 'COMPANY_REQUIRED' ||
    error.code === 'CREDIT_NOT_ELIGIBLE'
  );
}

type CreditSnapshot = {
  identity: string;
  reloadToken: number;
  summary: CreditAccountMemberResponse;
  status: CreditSummaryStatus;
  errorState: CheckoutErrorState | null;
  unavailable: boolean;
};

/** CheckoutPage compatibility facade. Feature concerns live in focused modules. */
export function useCheckoutFlow() {
  const { cart, cartId, cartGeneration, clearCart, retryCart } = useCartContext();
  const { user } = useAuth();
  const { activeCountry } = useOptionalCountry();
  const { translate } = useLocalisation();
  const isAuthenticated = user !== null;
  const cartPresent = Boolean(cart);
  const [state, dispatch] = useReducer(checkoutReducer, undefined, initialCheckoutState);
  const [creditReloadToken, setCreditReloadToken] = useState(0);
  const quoteKey = createCartQuoteKey(cart);
  const tradeProfile = useTradeProfile();
  const slots = useDeliverySlots(cartId, quoteKey);
  const offeredSlots = useMemo(() => slots.options?.slots ?? [], [slots.options]);

  const contactErrors = useMemo(() => validateContact(state.contact), [state.contact]);
  const deliveryValidation = useMemo(() => validateDelivery(state.delivery), [state.delivery]);
  const scheduleErrors = useMemo(
    () => validateSchedule(state.schedule, offeredSlots),
    [offeredSlots, state.schedule],
  );
  const billingValidation = useMemo(() => validateBilling(state.billing), [state.billing]);
  const cardErrors = useMemo(
    () => validateCard(state.card, state.paymentMethod),
    [state.card, state.paymentMethod],
  );

  const deliveryIsValid =
    Object.keys(contactErrors).length === 0 &&
    Object.keys(deliveryValidation.errors).length === 0 &&
    Object.keys(deliveryValidation.addressErrors).length === 0;
  const scheduleIsValid =
    Object.keys(scheduleErrors).length === 0 &&
    Object.keys(billingValidation.errors).length === 0 &&
    Object.keys(billingValidation.addressErrors).length === 0;
  const cardIsValid = Object.keys(cardErrors).length === 0;
  const navigation = useCheckoutNavigation(deliveryIsValid, scheduleIsValid);

  // A cart quote change and an account/country change are one checkout-intent transition. Keeping
  // one previous-context ref prevents either effect from rotating the key twice for one render.
  const intentContextRef = useRef<{
    quoteKey: string | null;
    accountIdentity: string;
  } | null>(null);
  const accountIdentity = `${user?.id ?? ''}:${activeCountry}`;
  useEffect(() => {
    const current = { quoteKey, accountIdentity };
    const previous = intentContextRef.current;
    if (previous) {
      if (previous.quoteKey !== current.quoteKey) {
        dispatch({ type: 'quote-changed', idempotencyKey: createIdempotencyKey() });
      } else if (previous.accountIdentity !== current.accountIdentity) {
        dispatch({ type: 'checkout-identity-changed', idempotencyKey: createIdempotencyKey() });
      }
    }
    intentContextRef.current = current;
  }, [accountIdentity, quoteKey]);

  const creditGeneration = useRef(0);
  const creditAbort = useRef<AbortController | null>(null);
  const creditSnapshotRef = useRef<CreditSnapshot | null>(null);
  // Credit eligibility belongs to the buyer/cart quote, not to the currently selected payment
  // method. This lets a blocked or ineligible result continue to disable the option after the
  // buyer temporarily switches to card, without carrying it into a new checkout intent.
  const creditIdentity = `${accountIdentity}:${cartId ?? ''}:${quoteKey ?? ''}`;

  useEffect(() => {
    const generation = ++creditGeneration.current;
    creditAbort.current?.abort();
    creditAbort.current = null;

    const cachedSnapshot = creditSnapshotRef.current;
    if (cachedSnapshot && cachedSnapshot.identity !== creditIdentity) {
      creditSnapshotRef.current = null;
    }

    // Credit is intentionally not requested for card/anonymous/unavailable-cart states. A settled
    // result for this same checkout intent is retained while card is selected so the radio cannot
    // become selectable again merely because the reducer resets method-local credit state.
    if (state.paymentMethod !== 'trade_credit') return;

    if (!isAuthenticated || !cartId || !cartPresent) {
      creditSnapshotRef.current = null;
      dispatch({ type: 'credit-summary-unavailable', creditIdentity });
      return;
    }

    const currentSnapshot = creditSnapshotRef.current;
    if (
      currentSnapshot?.identity === creditIdentity &&
      currentSnapshot.reloadToken === creditReloadToken &&
      (currentSnapshot.status === 'loaded' || currentSnapshot.status === 'unavailable')
    ) {
      return;
    }

    // A retry must not expose the previous settled result while the fresh server check is in
    // flight. The reducer's loading state remains the source for that transient projection.
    creditSnapshotRef.current = null;

    const controller = new AbortController();
    creditAbort.current = controller;
    const requestId = `${generation}:${creditIdentity}`;
    dispatch({ type: 'credit-summary-loading', requestId, creditIdentity });

    void (async () => {
      try {
        const summary = await getTradeCreditSummary({ signal: controller.signal });
        if (generation !== creditGeneration.current || controller.signal.aborted) return;
        const status = summary !== null && summary.state === 'active' ? 'loaded' : 'unavailable';
        creditSnapshotRef.current = {
          identity: creditIdentity,
          reloadToken: creditReloadToken,
          summary,
          status,
          errorState: null,
          unavailable: summary === null || summary.state !== 'active',
        };
        dispatch({ type: 'credit-summary-loaded', requestId, creditIdentity, summary });
      } catch (error) {
        if (generation !== creditGeneration.current || controller.signal.aborted || isAbort(error))
          return;
        if (creditResponseMeansUnavailable(error)) {
          creditSnapshotRef.current = {
            identity: creditIdentity,
            reloadToken: creditReloadToken,
            summary: null,
            status: 'unavailable',
            errorState: null,
            unavailable: true,
          };
          dispatch({ type: 'credit-summary-unavailable', requestId, creditIdentity });
        } else {
          const errorState = checkoutErrorState(
            error,
            'checkout.paymentMethod.tradeCreditLoadError',
          );
          creditSnapshotRef.current = {
            identity: creditIdentity,
            reloadToken: creditReloadToken,
            summary: null,
            status: 'error',
            errorState,
            unavailable: false,
          };
          dispatch({
            type: 'credit-summary-failed',
            requestId,
            creditIdentity,
            errorState,
          });
        }
      }
    })();

    return () => controller.abort();
  }, [
    activeCountry,
    cartId,
    cartPresent,
    creditIdentity,
    creditReloadToken,
    isAuthenticated,
    state.paymentMethod,
  ]);

  const reloadCreditSummary = useCallback(() => {
    setCreditReloadToken((token) => token + 1);
  }, []);

  // One-shot preselection of the buyer's default trade records. The reducer ignores these once the
  // buyer has touched the group, so a later list reload cannot overwrite an explicit choice.
  const savedSites = tradeProfile.deliverySites.items;
  const savedBillingEntities = tradeProfile.billingEntities.items;
  useEffect(() => {
    if (!isAuthenticated || tradeProfile.deliverySites.loading || savedSites.length === 0) return;
    const defaultSite = savedSites.find((site) => site.isDefault) ?? savedSites[0]!;
    dispatch({
      type: 'delivery-sites-loaded',
      defaultSiteId: defaultSite.id,
      idempotencyKey: createIdempotencyKey(),
    });
  }, [isAuthenticated, savedSites, tradeProfile.deliverySites.loading]);
  useEffect(() => {
    if (
      !isAuthenticated ||
      tradeProfile.billingEntities.loading ||
      savedBillingEntities.length === 0
    )
      return;
    const defaultEntity =
      savedBillingEntities.find((entity) => entity.isDefault) ?? savedBillingEntities[0]!;
    dispatch({
      type: 'billing-entities-loaded',
      defaultEntityId: defaultEntity.id,
      idempotencyKey: createIdempotencyKey(),
    });
  }, [isAuthenticated, savedBillingEntities, tradeProfile.billingEntities.loading]);

  const appliedPromo = selectAppliedPromo(state, quoteKey);
  const discountCents = selectDiscountCents(state, quoteKey);
  const discountBaseCents = appliedPromo ? state.discountBaseCents : null;
  const promoCategoryScope = appliedPromo ? state.promoCategoryScope : null;
  const deliveryChargeCents = cart?.deliveryPreview?.chargeCents ?? 0;
  const totalCents =
    appliedPromo && state.promoTotalCents !== null
      ? state.promoTotalCents
      : (cart?.subtotalCents ?? 0) - discountCents + deliveryChargeCents;
  const applyPromo = usePromoQuote({
    cartId,
    cartPresent,
    quoteKey,
    promoCode: state.promoCode,
    dispatch,
    retryCart,
  });
  // Effects invalidate old credit state after commit. Masking the projection during the render
  // that first observes a new identity keeps stale balance/eligibility out of the payment gate.
  const cachedCreditSnapshot =
    creditSnapshotRef.current?.identity === creditIdentity &&
    creditSnapshotRef.current.reloadToken === creditReloadToken
      ? creditSnapshotRef.current
      : null;
  const creditSummaryIsCurrent = state.creditSummaryIdentity === creditIdentity;
  const visibleCreditSummary = cachedCreditSnapshot
    ? cachedCreditSnapshot.summary
    : creditSummaryIsCurrent
      ? state.creditSummary
      : null;
  const visibleCreditSummaryStatus = cachedCreditSnapshot
    ? cachedCreditSnapshot.status
    : creditSummaryIsCurrent
      ? state.creditSummaryStatus
      : 'idle';
  const visibleCreditSummaryErrorState = cachedCreditSnapshot
    ? cachedCreditSnapshot.errorState
    : creditSummaryIsCurrent
      ? state.creditSummaryErrorState
      : null;
  const visibleCreditSummaryUnavailable = cachedCreditSnapshot
    ? cachedCreditSnapshot.unavailable
    : creditSummaryIsCurrent
      ? state.creditSummaryUnavailable
      : false;
  const tradeCreditAvailable =
    state.paymentMethod === 'card' ||
    (visibleCreditSummaryStatus === 'loaded' &&
      visibleCreditSummary !== null &&
      visibleCreditSummary.state === 'active');
  const submitPayment = usePaymentSubmission({
    cartId,
    cartGeneration,
    cartPresent: Boolean(cart),
    state,
    stepsAreValid: deliveryIsValid && scheduleIsValid,
    cardIsValid,
    appliedPromo,
    dispatch,
    clearCart,
    replaceWithOrder: navigation.replaceWithOrder,
    cardFields,
    userId: user?.id ?? null,
    tradeCreditAvailable,
  });

  const updateContact = useCallback(
    (field: (typeof contactFields)[number], value: string) =>
      dispatch({ type: 'contact-changed', field, value, idempotencyKey: createIdempotencyKey() }),
    [],
  );
  const updateDelivery = useCallback(
    (patch: Partial<CheckoutDelivery>) =>
      dispatch({ type: 'delivery-changed', patch, idempotencyKey: createIdempotencyKey() }),
    [],
  );
  const updateSchedule = useCallback(
    (slot: DeliverySlot | null) =>
      dispatch({ type: 'schedule-changed', slot, idempotencyKey: createIdempotencyKey() }),
    [],
  );
  const updateBilling = useCallback(
    (patch: Partial<CheckoutBilling>) =>
      dispatch({ type: 'billing-changed', patch, idempotencyKey: createIdempotencyKey() }),
    [],
  );
  const updateCard = useCallback(
    (field: (typeof cardFields)[number], value: string) =>
      dispatch({ type: 'card-changed', field, value, idempotencyKey: createIdempotencyKey() }),
    [],
  );
  const updatePaymentMethod = useCallback(
    (paymentMethod: (typeof paymentMethods)[number]) => {
      if (paymentMethod === state.paymentMethod) return;
      dispatch({
        type: 'payment-method-changed',
        paymentMethod,
        idempotencyKey: createIdempotencyKey(),
      });
    },
    [state.paymentMethod],
  );
  const touchField = useCallback((field: Field) => dispatch({ type: 'field-touched', field }), []);
  const goToSchedule = useCallback(() => {
    dispatch({ type: 'fields-touched', fields: deliveryStepFields });
    if (!deliveryIsValid) return;

    const selectedDeliverySite = savedSites.find(
      (site) => site.id === state.delivery.deliverySiteId,
    );
    const deliveryAddress =
      state.delivery.destinationKind === 'saved'
        ? selectedDeliverySite
          ? toPostalAddressDraft(
              selectedDeliverySite.address,
              state.delivery.address.profileCountry,
            )
          : undefined
        : state.delivery.address;
    if (deliveryAddress) {
      dispatch({
        type: 'billing-prefilled',
        patch: {
          legalName: state.contact.customerName,
          address: deliveryAddress,
        },
        idempotencyKey: createIdempotencyKey(),
      });
    }
    navigation.goToSchedule();
  }, [deliveryIsValid, navigation, savedSites, state.contact.customerName, state.delivery]);
  const goToPayment = useCallback(() => {
    dispatch({ type: 'fields-touched', fields: scheduleStepFields });
    if (scheduleIsValid) navigation.goToPayment();
  }, [navigation, scheduleIsValid]);
  const updatePromoCode = useCallback(
    (value: string) =>
      dispatch({ type: 'promo-changed', value, idempotencyKey: createIdempotencyKey() }),
    [],
  );
  const removePromo = useCallback(
    () => dispatch({ type: 'promo-removed', idempotencyKey: createIdempotencyKey() }),
    [],
  );
  const fieldError = useCallback(
    (field: Field) =>
      state.touched[field]
        ? (contactErrors[field] ??
          deliveryValidation.errors[field] ??
          scheduleErrors[field] ??
          billingValidation.errors[field] ??
          cardErrors[field])
        : undefined,
    [
      billingValidation.errors,
      cardErrors,
      contactErrors,
      deliveryValidation.errors,
      scheduleErrors,
      state.touched,
    ],
  );

  // Address errors surface only once the owning step has been submitted, matching field-level
  // touch behaviour: an untouched form must not open covered in red.
  const deliveryAddressErrors = state.touched.deliverySiteId
    ? deliveryValidation.addressErrors
    : {};
  const billingAddressErrors = state.touched.billingEntityId ? billingValidation.addressErrors : {};

  const paymentError = localizeCheckoutError(state.paymentErrorState, translate);
  const promoError = localizeCheckoutError(state.promoErrorState, translate);
  const creditSummaryError = localizeCheckoutError(visibleCreditSummaryErrorState, translate);

  const destinationSummary = useMemo(() => {
    if (state.delivery.destinationKind === 'saved') {
      return savedSites.find((site) => site.id === state.delivery.deliverySiteId)?.label ?? null;
    }
    const destination = buildDeliveryDestination(state.delivery);
    return destination?.kind === 'adhoc'
      ? [destination.address.line1, destination.address.city, destination.address.postcode].join(
          ', ',
        )
      : null;
  }, [savedSites, state.delivery]);

  const billingSummary = useMemo(() => {
    if (state.billing.selectionKind === 'saved') {
      return (
        savedBillingEntities.find((entity) => entity.id === state.billing.billingEntityId)
          ?.legalName ?? null
      );
    }
    const selection = buildBillingSelection(state.billing);
    return selection?.kind === 'adhoc' ? selection.billingEntity.legalName : null;
  }, [savedBillingEntities, state.billing]);

  return {
    cart,
    cartId,
    step: navigation.step,
    isAuthenticated,
    contact: state.contact,
    delivery: state.delivery,
    schedule: state.schedule,
    billing: state.billing,
    card: state.card,
    idempotencyKey: state.idempotencyKey,
    paymentMethod: state.paymentMethod,
    creditSummary: visibleCreditSummary,
    creditSummaryStatus: visibleCreditSummaryStatus,
    creditSummaryLoading: visibleCreditSummaryStatus === 'loading',
    creditSummaryError,
    creditSummaryErrorState: visibleCreditSummaryErrorState,
    creditSummaryUnavailable: visibleCreditSummaryUnavailable,
    reloadCreditSummary,
    retryCreditSummary: reloadCreditSummary,
    tradeCredit: {
      summary: visibleCreditSummary,
      status: visibleCreditSummaryStatus,
      loading: visibleCreditSummaryStatus === 'loading',
      error: creditSummaryError,
      errorState: visibleCreditSummaryErrorState,
      unavailable: visibleCreditSummaryUnavailable,
      reload: reloadCreditSummary,
    },
    savedSites,
    savedSitesLoading: tradeProfile.deliverySites.loading,
    savedSitesError: tradeProfile.deliverySites.error,
    reloadSavedSites: tradeProfile.reloadDeliverySites,
    savedBillingEntities,
    savedBillingEntitiesLoading: tradeProfile.billingEntities.loading,
    savedBillingEntitiesError: tradeProfile.billingEntities.error,
    reloadSavedBillingEntities: tradeProfile.reloadBillingEntities,
    slotOptions: slots.options,
    slotsLoading: slots.loading,
    slotsError: slots.error,
    reloadSlots: slots.reload,
    deliveryAddressErrors,
    billingAddressErrors,
    destinationSummary,
    billingSummary,
    purchaseOrderReference: state.billing.purchaseOrderReference.trim() || null,
    promoCode: state.promoCode,
    appliedPromo,
    discountCents,
    discountBaseCents,
    promoCategoryScope,
    totalCents,
    promoError:
      promoError ??
      (state.promoError ? translate(checkoutMessages, 'checkout.promoError.invalid') : null),
    promoErrorState: state.promoErrorState,
    promoErrorCode: state.promoErrorCode,
    promoMinSubtotalCents: state.promoMinSubtotalCents,
    promoValidating: state.promoValidating,
    isPromoEligible: cart ? isEligibleForPromo(cart.totalItems) : false,
    submitting: state.submitting,
    paymentError:
      paymentError ??
      (state.paymentError ? translate(checkoutMessages, 'checkout.error.generic') : null),
    paymentErrorState: state.paymentErrorState,
    conflict: state.conflict,
    cartRecoveryMessage: state.cartRecoveryMessage,
    fieldError,
    updateContact,
    updateDelivery,
    updateSchedule,
    updateBilling,
    updateCard,
    updatePaymentMethod,
    setPaymentMethod: updatePaymentMethod,
    selectPaymentMethod: updatePaymentMethod,
    touchField,
    goToSchedule,
    goToPayment,
    goToDelivery: navigation.goToDelivery,
    goToScheduleStep: navigation.goToSchedule,
    updatePromoCode,
    applyPromo,
    removePromo,
    submitPayment,
  };
}
