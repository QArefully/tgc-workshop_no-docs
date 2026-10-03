import type { DeliverySlot } from '@shop/contracts/delivery';
import type { BillingSelection, DeliveryDestination } from '@shop/contracts/payments';
import {
  validatePostalAddressDraft,
  type PostalAddressFieldErrors,
} from '@/features/account/PostalAddressFields';
import {
  slotKey,
  type CheckoutPaymentMethod,
  type CheckoutState,
  type FieldErrors,
} from './checkoutState';

/**
 * Validation for the three-step checkout.
 *
 * These rules exist to keep the buyer out of an avoidable round trip; the backend re-validates
 * everything and stays authoritative for address resolution and slot bookability. Bounds mirror
 * `@shop/contracts` so a value accepted here is never rejected as a 400 downstream.
 */

/** A field group whose address sub-form carries its own error map. */
export interface GroupValidation {
  errors: FieldErrors;
  addressErrors: PostalAddressFieldErrors;
}

const MAX_LEGAL_NAME_LENGTH = 120;
const MAX_IDENTIFIER_LENGTH = 40;
const MAX_PURCHASE_ORDER_REFERENCE_LENGTH = 64;
const MARKUP_PATTERN = /[<>]/;

function checkOptionalText(value: string, label: string, maxLength: number): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > maxLength) return `${label} must be ${maxLength} characters or fewer`;
  if (MARKUP_PATTERN.test(trimmed)) return `${label} cannot contain < or >`;
  return undefined;
}

export function validateContact(contact: CheckoutState['contact']): FieldErrors {
  const errors: FieldErrors = {};
  if (!contact.customerName.trim()) errors.customerName = 'Name is required';
  if (!contact.customerEmail.trim()) errors.customerEmail = 'Email is required';
  else if (!/^[^\s@]+@[^\s@]+$/.test(contact.customerEmail.trim()))
    errors.customerEmail = 'Enter a valid email';
  return errors;
}

/**
 * Delivery destination rules. A saved selection only needs an identifier, because the server loads
 * the stored site and ignores any address the client holds alongside it.
 */
export function validateDelivery(delivery: CheckoutState['delivery']): GroupValidation {
  if (delivery.destinationKind === 'saved') {
    return {
      errors: delivery.deliverySiteId ? {} : { deliverySiteId: 'Select a delivery site' },
      addressErrors: {},
    };
  }
  const address = validatePostalAddressDraft(delivery.address);
  return { errors: {}, addressErrors: address.ok ? {} : address.errors };
}

/**
 * Slot rules. The chosen slot must still be one of the slots the server currently offers: a cart
 * change re-derives lead time, and a slot held from the previous list is no longer bookable.
 */
export function validateSchedule(
  schedule: CheckoutState['schedule'],
  offeredSlots: DeliverySlot[],
): FieldErrors {
  if (!schedule.slot) return { deliverySlot: 'Choose a delivery slot' };
  const chosen = slotKey(schedule.slot);
  if (!offeredSlots.some((slot) => slotKey(slot) === chosen)) {
    return { deliverySlot: 'That slot is no longer offered. Choose another.' };
  }
  return {};
}

/** Billing party plus the optional buyer reference captured on the same step. */
export function validateBilling(billing: CheckoutState['billing']): GroupValidation {
  const errors: FieldErrors = {};
  const purchaseOrderError = checkOptionalText(
    billing.purchaseOrderReference,
    'Purchase order reference',
    MAX_PURCHASE_ORDER_REFERENCE_LENGTH,
  );
  if (purchaseOrderError) errors.purchaseOrderReference = purchaseOrderError;

  if (billing.selectionKind === 'saved') {
    if (!billing.billingEntityId) errors.billingEntityId = 'Select a billing account';
    return { errors, addressErrors: {} };
  }

  const legalName = billing.legalName.trim();
  if (!legalName) errors.billingLegalName = 'Legal entity name is required';
  else if (legalName.length > MAX_LEGAL_NAME_LENGTH)
    errors.billingLegalName = `Legal entity name must be ${MAX_LEGAL_NAME_LENGTH} characters or fewer`;
  else if (MARKUP_PATTERN.test(legalName))
    errors.billingLegalName = 'Legal entity name cannot contain < or >';

  const registrationError = checkOptionalText(
    billing.registrationNumber,
    'Registration number',
    MAX_IDENTIFIER_LENGTH,
  );
  if (registrationError) errors.billingRegistrationNumber = registrationError;
  const vatError = checkOptionalText(billing.vatNumber, 'VAT number', MAX_IDENTIFIER_LENGTH);
  if (vatError) errors.billingVatNumber = vatError;

  const address = validatePostalAddressDraft(billing.address);
  return { errors, addressErrors: address.ok ? {} : address.errors };
}

/** Card fields are required only for the card branch; trade credit deliberately has no card input. */
export function validateCard(
  card: CheckoutState['card'],
  paymentMethod: CheckoutPaymentMethod = 'card',
): FieldErrors {
  if (paymentMethod === 'trade_credit') return {};
  const errors: FieldErrors = {};
  if (!/^[0-9 -]{12,25}$/.test(card.cardNumber)) errors.cardNumber = 'Enter a valid card number';
  if (!/^(0[1-9]|1[0-2])\/[0-9]{2}$/.test(card.cardExpiry))
    errors.cardExpiry = 'Enter expiry as MM/YY';
  if (!/^[0-9]{3,4}$/.test(card.cardCvc)) errors.cardCvc = 'Enter a valid CVC';
  return errors;
}

/**
 * Builds the transport destination union from step state. Returns `null` when the draft cannot
 * produce a contract-valid payload, so the submit path can never send a half-formed address.
 */
export function buildDeliveryDestination(
  delivery: CheckoutState['delivery'],
): DeliveryDestination | null {
  if (delivery.destinationKind === 'saved') {
    return delivery.deliverySiteId
      ? { kind: 'saved', deliverySiteId: delivery.deliverySiteId }
      : null;
  }
  const address = validatePostalAddressDraft(delivery.address);
  return address.ok ? { kind: 'adhoc', address: address.address } : null;
}

/** Same contract-or-nothing rule as `buildDeliveryDestination`, for the billing party. */
export function buildBillingSelection(billing: CheckoutState['billing']): BillingSelection | null {
  if (billing.selectionKind === 'saved') {
    return billing.billingEntityId
      ? { kind: 'saved', billingEntityId: billing.billingEntityId }
      : null;
  }
  const address = validatePostalAddressDraft(billing.address);
  const legalName = billing.legalName.trim();
  if (!address.ok || !legalName) return null;
  const registrationNumber = billing.registrationNumber.trim();
  const vatNumber = billing.vatNumber.trim();
  return {
    kind: 'adhoc',
    billingEntity: {
      legalName,
      address: address.address,
      // Blank optional identifiers are omitted: the contract rejects empty strings.
      ...(registrationNumber ? { registrationNumber } : {}),
      ...(vatNumber ? { vatNumber } : {}),
    },
  };
}
