import { describe, expect, it } from 'vitest';
import { checkoutReducer, createCartQuoteKey, initialCheckoutState } from './checkoutState';

describe('checkoutState', () => {
  it('changes payment method once, clears card secrets, and ignores duplicate selection', () => {
    let state = checkoutReducer(initialCheckoutState(), {
      type: 'card-changed',
      field: 'cardCvc',
      value: '123',
      idempotencyKey: 'card-key',
    });
    state = checkoutReducer(state, { type: 'field-touched', field: 'cardCvc' });

    const changed = checkoutReducer(state, {
      type: 'payment-method-changed',
      paymentMethod: 'trade_credit',
      idempotencyKey: 'credit-key',
    });
    expect(changed).toMatchObject({
      paymentMethod: 'trade_credit',
      card: { cardNumber: '', cardExpiry: '', cardCvc: '' },
      idempotencyKey: 'credit-key',
    });
    expect(changed.touched).not.toHaveProperty('cardCvc');
    expect(
      checkoutReducer(changed, {
        type: 'payment-method-changed',
        paymentMethod: 'trade_credit',
        idempotencyKey: 'must-not-rotate',
      }),
    ).toBe(changed);
  });

  it('keeps credit lifecycle events off the payment idempotency key and rejects stale events', () => {
    let state = initialCheckoutState();
    state = checkoutReducer(state, { type: 'credit-summary-loading', requestId: 'fresh' });
    const loadingKey = state.idempotencyKey;
    state = checkoutReducer(state, {
      type: 'credit-summary-failed',
      requestId: 'stale',
      error: 'stale',
    });
    expect(state.creditSummaryStatus).toBe('loading');
    expect(state.idempotencyKey).toBe(loadingKey);
    state = checkoutReducer(state, { type: 'credit-summary-unavailable', requestId: 'fresh' });
    expect(state.creditSummaryStatus).toBe('unavailable');
    expect(state.creditSummaryUnavailable).toBe(true);
  });

  it('transitions contact, card, promo, quote, and submission state', () => {
    let state = initialCheckoutState();
    state = checkoutReducer(state, {
      type: 'contact-changed',
      field: 'customerName',
      value: 'Ava',
      idempotencyKey: 'contact',
    });
    state = checkoutReducer(state, {
      type: 'card-changed',
      field: 'cardCvc',
      value: '123',
      idempotencyKey: 'card',
    });
    state = checkoutReducer(state, {
      type: 'promo-changed',
      value: 'SAVE10',
      idempotencyKey: 'promo',
    });
    state = checkoutReducer(state, { type: 'promo-started' });
    state = checkoutReducer(state, {
      type: 'promo-applied',
      promoCode: 'SAVE10',
      quoteKey: 'quote-a',
      discountCents: 100,
      discountBaseCents: 1000,
      promoCategoryScope: 'aggregates',
      totalCents: 900,
    });
    state = checkoutReducer(state, { type: 'submission-started' });

    expect(state).toMatchObject({
      contact: { customerName: 'Ava' },
      card: { cardCvc: '123' },
      promoCode: 'SAVE10',
      appliedPromo: 'SAVE10',
      discountCents: 100,
      discountBaseCents: 1000,
      promoCategoryScope: 'aggregates',
      submitting: true,
      idempotencyKey: 'promo',
    });

    state = checkoutReducer(state, { type: 'quote-changed', idempotencyKey: 'cart-change' });
    state = checkoutReducer(state, { type: 'submission-failed', error: 'declined' });
    state = checkoutReducer(state, { type: 'submission-finished' });
    expect(state).toMatchObject({
      appliedPromo: null,
      discountCents: 0,
      discountBaseCents: null,
      promoCategoryScope: null,
      promoValidating: false,
      submitting: false,
      paymentError: 'declined',
      idempotencyKey: 'cart-change',
    });
  });

  it('rotates the idempotency key for every new checkout field group', () => {
    let state = initialCheckoutState();
    state = checkoutReducer(state, {
      type: 'delivery-changed',
      patch: { destinationKind: 'saved', deliverySiteId: '4' },
      idempotencyKey: 'after-destination',
    });
    expect(state.idempotencyKey).toBe('after-destination');
    expect(state.delivery).toMatchObject({ destinationKind: 'saved', deliverySiteId: '4' });

    state = checkoutReducer(state, {
      type: 'schedule-changed',
      slot: { date: '2026-08-03', window: 'am' },
      idempotencyKey: 'after-slot',
    });
    expect(state.idempotencyKey).toBe('after-slot');

    state = checkoutReducer(state, {
      type: 'billing-changed',
      patch: { purchaseOrderReference: 'PO-42' },
      idempotencyKey: 'after-po',
    });
    expect(state.idempotencyKey).toBe('after-po');
    expect(state.billing.purchaseOrderReference).toBe('PO-42');
  });

  it('clears a category-mismatch code when a promo retry succeeds', () => {
    let state = checkoutReducer(initialCheckoutState(), {
      type: 'promo-failed',
      error: 'This code only applies to aggregates.',
      errorCode: 'CATEGORY_MISMATCH',
    });
    expect(state.promoErrorCode).toBe('CATEGORY_MISMATCH');

    state = checkoutReducer(state, { type: 'promo-started' });
    expect(state).toMatchObject({ promoError: null, promoErrorCode: null, promoValidating: true });

    state = checkoutReducer(state, {
      type: 'promo-applied',
      promoCode: 'AGG10',
      quoteKey: 'quote-retry',
      discountCents: 100,
      discountBaseCents: 1000,
      promoCategoryScope: 'aggregates',
      totalCents: 900,
    });
    expect(state).toMatchObject({
      appliedPromo: 'AGG10',
      promoError: null,
      promoErrorCode: null,
      promoValidating: false,
    });
  });

  it('preselects a default site only until the buyer chooses for themselves', () => {
    let state = initialCheckoutState();
    state = checkoutReducer(state, {
      type: 'delivery-sites-loaded',
      defaultSiteId: '2',
      idempotencyKey: 'preselect',
    });
    expect(state.delivery).toMatchObject({ destinationKind: 'saved', deliverySiteId: '2' });

    state = checkoutReducer(state, {
      type: 'delivery-changed',
      patch: { destinationKind: 'adhoc', deliverySiteId: '' },
      idempotencyKey: 'buyer-choice',
    });
    const afterChoice = checkoutReducer(state, {
      type: 'delivery-sites-loaded',
      defaultSiteId: '2',
      idempotencyKey: 'late-reload',
    });
    expect(afterChoice).toBe(state);
  });

  it('clears only a slot-unavailable conflict when a new slot is chosen', () => {
    let state = initialCheckoutState();
    state = checkoutReducer(state, {
      type: 'conflict',
      conflict: { code: 'DELIVERY_SLOT_UNAVAILABLE', earliestDate: '2026-08-05' },
      idempotencyKey: 'conflict',
    });
    state = checkoutReducer(state, {
      type: 'schedule-changed',
      slot: { date: '2026-08-05', window: 'pm' },
      idempotencyKey: 'reschedule',
    });
    expect(state.conflict).toBeNull();

    state = checkoutReducer(state, {
      type: 'conflict',
      conflict: { code: 'INSUFFICIENT_STOCK', productIds: ['1'] },
      idempotencyKey: 'stock',
    });
    state = checkoutReducer(state, {
      type: 'schedule-changed',
      slot: { date: '2026-08-06', window: 'am' },
      idempotencyKey: 'reschedule-2',
    });
    expect(state.conflict).toEqual({ code: 'INSUFFICIENT_STOCK', productIds: ['1'] });
  });

  it('creates an order-stable quote key', () => {
    const first = {
      id: 'cart',
      subtotalCents: 300,
      items: [
        { productId: 'b', quantity: 1, lineTotalCents: 200 },
        { productId: 'a', quantity: 1, lineTotalCents: 100 },
      ],
    };
    const reordered = { ...first, items: [...first.items].reverse() };

    expect(createCartQuoteKey(first)).toBe(createCartQuoteKey(reordered));
  });
});
