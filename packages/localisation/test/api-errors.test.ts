import assert from 'node:assert/strict';
import test from 'node:test';
import { PUBLIC_ERROR_CODES } from '@shop/contracts/public-errors';
import { SUPPORTED_COUNTRIES } from '@shop/contracts/country';
import { translate, type MessageParams } from '../src/index.js';
import { apiErrors } from '../src/messages/apiErrors.js';

function paramsFor(code: string): MessageParams {
  switch (code) {
    case 'RATE_LIMITED':
      return { retryAfterSeconds: 30 };
    case 'BELOW_MOQ':
      return { minQuantity: 2 };
    case 'PROMO_MIN_SUBTOTAL':
      return { minSubtotalCents: 1_000 };
    case 'RESERVATION_EXPIRED':
      return { reservationExpiresAt: '2026-01-02T23:30:00.000Z' };
    case 'DELIVERY_SLOT_UNAVAILABLE':
      return { earliestDate: '2026-01-02' };
    case 'PENDING_APPROVAL':
      return { approvalRequestId: '14' };
    case 'CREDIT_LIMIT_EXCEEDED':
      return { requestedCents: 12_500, availableCreditCents: 10_000 };
    case 'INVOICE_SETTLEMENT_INVALID':
    case 'INVOICE_SETTLEMENT_CONFLICT':
      return { invoiceId: '14' };
    case 'CUSTOM_BLEND_PIGMENT_CAP_EXCEEDED':
      return { maxPercentage: 10, actualPercentage: 15 };
    default:
      return {};
  }
}

void test('API error catalog has every public code in every country', () => {
  assert.deepEqual(Object.keys(apiErrors).sort(), [...PUBLIC_ERROR_CODES].sort());
  for (const code of PUBLIC_ERROR_CODES) {
    const entries = apiErrors[code];
    assert.deepEqual(Object.keys(entries).sort(), [...SUPPORTED_COUNTRIES].sort(), code);
    for (const country of SUPPORTED_COUNTRIES)
      assert.notEqual(
        translate(apiErrors, country, code, paramsFor(code)),
        '',
        `${code}.${country}`,
      );
  }
});

void test('placeholder-bearing public errors retain interpolation parity', () => {
  assert.equal(
    translate(apiErrors, 'UK', 'DELIVERY_SLOT_UNAVAILABLE', { earliestDate: '2026-01-02' }),
    'That delivery slot is unavailable. Earliest date: 2026-01-02.',
  );
  assert.equal(
    translate(apiErrors, 'DE', 'PENDING_APPROVAL', { approvalRequestId: '14' }),
    'Eine Genehmigung ist erforderlich (Anfrage 14).',
  );
  assert.equal(
    translate(apiErrors, 'UK', 'CUSTOM_BLEND_INCOMPATIBLE'),
    'The selected materials cannot be combined.',
  );
  assert.equal(
    translate(apiErrors, 'FR', 'CUSTOM_BLEND_PIGMENT_CAP_EXCEEDED', {
      maxPercentage: 10,
      actualPercentage: 15,
    }),
    'La teneur en pigment ne peut pas dépasser 10% (sélection : 15%).',
  );
  assert.throws(
    () => translate(apiErrors, 'UK', 'RATE_LIMITED'),
    /Missing parameter \{retryAfterSeconds\}/,
  );
});
