import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import { SUPPORTED_COUNTRIES } from '../src/country.js';
import {
  ErrorResponse,
  PUBLIC_ERROR_CODES,
  PublicErrorCode,
  PublicErrorMeta,
  PublicErrorMetaByCodeSchema,
  PublicErrorResponse,
} from '../src/index.js';

void test('public error code schema is closed and exhaustive', () => {
  for (const code of PUBLIC_ERROR_CODES)
    assert.equal(Value.Check(PublicErrorCode, code), true, code);
  assert.equal(Value.Check(PublicErrorCode, 'RAW_EXCEPTION'), false);
  assert.equal(Value.Check(PublicErrorCode, 'AJV_VALIDATION_DETAILS'), false);
});

void test('metadata accepts only safe typed identifiers, counts, money, and dates', () => {
  assert.equal(
    Value.Check(PublicErrorMeta, {
      productIds: ['12', '13'],
    }),
    true,
  );
  assert.equal(
    Value.Check(PublicErrorMeta, { reservationExpiresAt: '2026-01-02T23:30:00.000Z' }),
    true,
  );
  assert.equal(Value.Check(PublicErrorMeta, { productIds: ['0'] }), false);
  assert.equal(Value.Check(PublicErrorMeta, { amountCents: -1 }), false);
  assert.equal(Value.Check(PublicErrorMeta, { exception: 'secret' }), false);
  assert.equal(Value.Check(PublicErrorMeta, { details: { stack: 'secret' } }), false);
  assert.equal(Value.Check(PublicErrorMeta, { earliestDate: '02/01/2026' }), false);
});

void test('every public code has a strict metadata schema', () => {
  for (const code of PUBLIC_ERROR_CODES) {
    assert.ok(PublicErrorMetaByCodeSchema[code], code);
    assert.equal(Value.Check(PublicErrorResponse, { error: 'coded response', code }), true, code);
  }
});

void test('error response is a strict legacy/new union', () => {
  assert.equal(Value.Check(ErrorResponse, { error: 'legacy response' }), true);
  assert.equal(
    Value.Check(ErrorResponse, { error: 'legacy response', details: { field: 'email' } }),
    true,
  );
  assert.equal(
    Value.Check(ErrorResponse, {
      error: 'legacy response',
      code: 'NOT_FOUND',
      details: { resource: 'hidden' },
    }),
    false,
  );
  assert.equal(Value.Check(ErrorResponse, { error: 'legacy response', meta: {} }), false);
  assert.equal(
    Value.Check(PublicErrorResponse, {
      error: 'Not enough stock',
      code: 'INSUFFICIENT_STOCK',
      meta: { productIds: ['42'] },
    }),
    true,
  );
  assert.equal(
    Value.Check(PublicErrorResponse, {
      error: 'Not enough stock',
      code: 'INSUFFICIENT_STOCK',
      meta: { productIds: ['42'], variantId: '7' },
    }),
    false,
  );
  assert.equal(
    Value.Check(PublicErrorResponse, {
      error: 'Not found',
      code: 'NOT_FOUND',
      meta: {},
    }),
    true,
  );
  assert.equal(
    Value.Check(PublicErrorResponse, {
      error: 'Not found',
      code: 'NOT_FOUND',
      meta: { orderId: '42' },
    }),
    false,
  );
  assert.equal(
    Value.Check(PublicErrorResponse, {
      error: 'Below minimum',
      code: 'BELOW_MOQ',
      meta: { minQuantity: 4 },
    }),
    true,
  );
  assert.equal(
    Value.Check(PublicErrorResponse, {
      error: 'Below minimum',
      code: 'BELOW_MOQ',
      meta: { quantity: 4 },
    }),
    false,
  );
  assert.equal(
    Value.Check(PublicErrorResponse, {
      error: 'Pigment cap exceeded',
      code: 'CUSTOM_BLEND_PIGMENT_CAP_EXCEEDED',
      meta: { maxPercentage: 10, actualPercentage: 15 },
    }),
    true,
  );
  assert.equal(
    Value.Check(PublicErrorResponse, {
      error: 'Pigment cap exceeded',
      code: 'CUSTOM_BLEND_PIGMENT_CAP_EXCEEDED',
      meta: { maxPercentage: 10 },
    }),
    false,
  );
  assert.equal(
    Value.Check(PublicErrorResponse, {
      error: 'Pigment cap exceeded',
      code: 'CUSTOM_BLEND_PIGMENT_CAP_EXCEEDED',
      meta: { maxPercentage: 10, actualPercentage: 15, variantId: '7' },
    }),
    false,
  );
  assert.equal(
    Value.Check(PublicErrorResponse, {
      error: 'Pigment cap exceeded',
      code: 'CUSTOM_BLEND_PIGMENT_CAP_EXCEEDED',
      meta: { maxPercentage: Number.MAX_SAFE_INTEGER + 1, actualPercentage: 15 },
    }),
    false,
  );
  assert.equal(
    Value.Check(PublicErrorResponse, {
      error: 'Incompatible ingredients',
      code: 'CUSTOM_BLEND_INCOMPATIBLE',
      meta: { maxPercentage: 10, actualPercentage: 15 },
    }),
    false,
  );
  assert.equal(
    Value.Check(PublicErrorResponse, {
      error: 'Coded response',
      code: 'RATE_LIMITED',
      details: { retryAfterSeconds: 5 },
    }),
    false,
  );
  assert.equal(Value.Check(ErrorResponse, { error: 'bad', code: 'UNKNOWN_CODE' }), false);
  assert.deepEqual([...SUPPORTED_COUNTRIES].sort(), ['CN', 'DE', 'ES', 'FR', 'PL', 'UK', 'US']);
});
