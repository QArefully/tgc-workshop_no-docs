import { describe, expect, it } from 'vitest';
import { EMPTY_POSTAL_ADDRESS_DRAFT } from '@/features/account/PostalAddressFields';
import { initialCheckoutState } from './checkoutState';
import {
  buildBillingSelection,
  buildDeliveryDestination,
  validateBilling,
  validateCard,
  validateContact,
  validateDelivery,
  validateSchedule,
} from './checkoutValidation';

const address = {
  ...EMPTY_POSTAL_ADDRESS_DRAFT,
  line1: '1 Test Street',
  city: 'Testville',
  postcode: 'TE1 1ST',
};

describe('checkout validation', () => {
  it('accepts trimmed valid contact fields and rejects email boundaries', () => {
    expect(validateContact({ customerName: ' Ava ', customerEmail: 'ava@example.test ' })).toEqual(
      {},
    );
    expect(validateContact({ customerName: '', customerEmail: 'ava.example' })).toEqual({
      customerName: 'Name is required',
      customerEmail: 'Enter a valid email',
    });
  });

  it('requires an identifier for a saved site and a full address for an ad-hoc one', () => {
    const base = initialCheckoutState().delivery;
    expect(validateDelivery({ ...base, destinationKind: 'saved', deliverySiteId: '' })).toEqual({
      errors: { deliverySiteId: 'Select a delivery site' },
      addressErrors: {},
    });
    expect(validateDelivery({ ...base, destinationKind: 'saved', deliverySiteId: '7' })).toEqual({
      errors: {},
      addressErrors: {},
    });
    expect(validateDelivery({ ...base, destinationKind: 'adhoc', address }).addressErrors).toEqual(
      {},
    );
    expect(validateDelivery({ ...base, destinationKind: 'adhoc' }).addressErrors.line1).toBe(
      'Address line 1 is required',
    );
  });

  it('rejects a slot that the server no longer offers', () => {
    const offered = [{ date: '2026-08-03', window: 'am' as const }];
    expect(validateSchedule({ slot: null }, offered)).toEqual({
      deliverySlot: 'Choose a delivery slot',
    });
    expect(validateSchedule({ slot: offered[0]! }, offered)).toEqual({});
    expect(validateSchedule({ slot: { date: '2026-07-01', window: 'pm' } }, offered)).toEqual({
      deliverySlot: 'That slot is no longer offered. Choose another.',
    });
  });

  it('bounds the billing party and the optional purchase order reference', () => {
    const base = initialCheckoutState().billing;
    expect(
      validateBilling({ ...base, selectionKind: 'saved', billingEntityId: '' }).errors,
    ).toEqual({ billingEntityId: 'Select a billing account' });
    expect(
      validateBilling({ ...base, selectionKind: 'adhoc', legalName: '', address }).errors,
    ).toEqual({ billingLegalName: 'Legal entity name is required' });
    expect(
      validateBilling({
        ...base,
        selectionKind: 'saved',
        billingEntityId: '3',
        purchaseOrderReference: 'x'.repeat(65),
      }).errors.purchaseOrderReference,
    ).toBe('Purchase order reference must be 64 characters or fewer');
    expect(
      validateBilling({
        ...base,
        selectionKind: 'saved',
        billingEntityId: '3',
        purchaseOrderReference: '  PO-1  ',
      }).errors,
    ).toEqual({});
  });

  it('builds contract-shaped unions and omits blank optional identifiers', () => {
    const delivery = initialCheckoutState().delivery;
    expect(buildDeliveryDestination({ ...delivery, destinationKind: 'adhoc', address })).toEqual({
      kind: 'adhoc',
      address: {
        line1: '1 Test Street',
        city: 'Testville',
        postcode: 'TE1 1ST',
        countryCode: 'GB',
      },
    });
    expect(buildDeliveryDestination({ ...delivery, destinationKind: 'adhoc' })).toBeNull();

    const billing = initialCheckoutState().billing;
    expect(
      buildBillingSelection({
        ...billing,
        selectionKind: 'adhoc',
        legalName: ' Test Trading Ltd ',
        address,
      }),
    ).toEqual({
      kind: 'adhoc',
      billingEntity: {
        legalName: 'Test Trading Ltd',
        address: {
          line1: '1 Test Street',
          city: 'Testville',
          postcode: 'TE1 1ST',
          countryCode: 'GB',
        },
      },
    });
    expect(
      buildBillingSelection({ ...billing, selectionKind: 'saved', billingEntityId: '9' }),
    ).toEqual({ kind: 'saved', billingEntityId: '9' });
  });

  it('accepts 12-digit cards and rejects invalid expiry and CVC boundaries', () => {
    expect(
      validateCard({ cardNumber: '424242424242', cardExpiry: '01/30', cardCvc: '123' }),
    ).toEqual({});
    expect(validateCard({ cardNumber: '4242', cardExpiry: '00/30', cardCvc: '12' })).toEqual({
      cardNumber: 'Enter a valid card number',
      cardExpiry: 'Enter expiry as MM/YY',
      cardCvc: 'Enter a valid CVC',
    });
  });

  it('skips card validation for trade-credit checkout', () => {
    expect(validateCard({ cardNumber: '', cardExpiry: '', cardCvc: '' }, 'trade_credit')).toEqual(
      {},
    );
  });
});
