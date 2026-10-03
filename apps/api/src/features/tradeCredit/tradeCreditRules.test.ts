import assert from 'node:assert/strict';
import test from 'node:test';
import { TRADE_CREDIT_TERMS_DAYS } from '@shop/contracts/trade-credit';
import {
  VAT_BASIS_POINTS_DENOMINATOR,
  calculateAvailableCredit,
  calculateCreditExposure,
  calculateInvoiceDueAt,
  calculateInvoiceNetCents,
  calculateInvoiceTotals,
  calculateVatCents,
  deriveCreditExposure,
  deriveInvoiceLifecycleStatus,
  evaluateTradeCreditEligibility,
  isInvoiceOverdue,
  isTradeCreditEligible,
  TRADE_CREDIT_TERM_MS,
} from './tradeCreditRules.js';

void test('computes invoice net, VAT, and gross at invoice scope', () => {
  assert.deepEqual(
    calculateInvoiceTotals({
      merchandiseCents: 10_000,
      promoDiscountCents: 500,
      deliveryCents: 1_500,
      vatRateBasisPoints: 2_000,
    }),
    { netCents: 11_000, vatCents: 2_200, grossCents: 13_200 },
  );
  assert.deepEqual(calculateInvoiceTotals(10_000, 500, 1_500, 2_000), {
    netCents: 11_000,
    vatCents: 2_200,
    grossCents: 13_200,
  });
  assert.equal(calculateInvoiceNetCents(0, 0, 0), 0);
  assert.deepEqual(
    calculateInvoiceTotals({
      merchandiseSubtotalCents: 1,
      discountCents: 0,
      deliveryChargeCents: 0,
      vatRateBasisPoints: 0,
    }),
    { netCents: 1, vatCents: 0, grossCents: 1 },
  );
});

void test('rounds exact VAT halves upwards and keeps zero-rate VAT zero', () => {
  assert.equal(calculateVatCents(1, 5_000), 1);
  assert.equal(calculateVatCents(3, 5_000), 2);
  assert.equal(calculateVatCents(10_000, 0), 0);
  assert.equal(VAT_BASIS_POINTS_DENOMINATOR, 10_000);
});

void test('rejects unsafe or negative invoice arithmetic before overflow', () => {
  const max = Number.MAX_SAFE_INTEGER;
  assert.throws(
    () => calculateInvoiceTotals({ merchandiseCents: -1, vatRateBasisPoints: 2_000 }),
    RangeError,
  );
  assert.throws(
    () =>
      calculateInvoiceTotals({
        merchandiseCents: 100,
        promoDiscountCents: 101,
        vatRateBasisPoints: 2_000,
      }),
    RangeError,
  );
  assert.throws(
    () =>
      calculateInvoiceTotals({ merchandiseCents: max, deliveryCents: 1, vatRateBasisPoints: 0 }),
    RangeError,
  );
  assert.throws(() => calculateVatCents(max, 2), RangeError);
  assert.throws(() => calculateVatCents(1, 10_001), RangeError);
  assert.throws(() => calculateVatCents(1.5, 2_000), RangeError);
});

void test('combines outstanding invoices and both payment hold states', () => {
  assert.equal(calculateCreditExposure(25_000, 10_000, 5_000), 40_000);
  assert.equal(
    calculateCreditExposure({
      outstandingInvoiceCents: 25_000,
      preparedHoldCents: 10_000,
      authorizedHoldCents: 5_000,
    }),
    40_000,
  );
  assert.deepEqual(
    deriveCreditExposure({
      creditLimitCents: 50_000,
      outstandingInvoiceCents: 25_000,
      preparedHoldCents: 10_000,
      authorizedHoldCents: 5_000,
    }),
    {
      outstandingCents: 25_000,
      heldCents: 15_000,
      exposureCents: 40_000,
      availableCreditCents: 10_000,
    },
  );
  assert.equal(calculateAvailableCredit(50_000, 50_000), 0);
  assert.equal(calculateAvailableCredit(50_000, 50_001), 0);
});

void test('rejects exposure alias disagreement and unsafe sums', () => {
  const max = Number.MAX_SAFE_INTEGER;
  assert.throws(
    () => calculateCreditExposure({ outstandingInvoiceCents: 1, outstandingCents: 2 }),
    RangeError,
  );
  assert.throws(
    () => calculateCreditExposure({ outstandingInvoiceCents: max, preparedHoldCents: 1 }),
    RangeError,
  );
  assert.throws(
    () => deriveCreditExposure({ creditLimitCents: 1, outstandingInvoiceCents: -1 }),
    RangeError,
  );
  assert.throws(() => calculateAvailableCredit(-1, 0), RangeError);
});

void test('requires active company/member buyer authority and active credit state', () => {
  const eligible = {
    company: { id: '7', active: true },
    membership: { companyId: '7', active: true, role: 'buyer' },
    creditAccount: { companyId: '7', state: 'active' },
    approvalGranted: true,
  } as const;
  assert.equal(isTradeCreditEligible(eligible), true);
  assert.deepEqual(evaluateTradeCreditEligibility(eligible), { eligible: true });
  assert.equal(
    isTradeCreditEligible({ ...eligible, membership: { ...eligible.membership, role: 'owner' } }),
    true,
  );
  assert.equal(
    isTradeCreditEligible({
      ...eligible,
      membership: { ...eligible.membership, role: 'approver' },
    }),
    false,
  );
  assert.equal(
    isTradeCreditEligible({ ...eligible, company: { ...eligible.company, active: false } }),
    false,
  );
  assert.equal(
    isTradeCreditEligible({ ...eligible, membership: { ...eligible.membership, active: false } }),
    false,
  );
  assert.equal(
    isTradeCreditEligible({
      ...eligible,
      creditAccount: { ...eligible.creditAccount, state: 'on_hold' },
    }),
    false,
  );
  assert.equal(isTradeCreditEligible({ ...eligible, approvalGranted: false }), true);
  assert.equal(isTradeCreditEligible(true, true, 'buyer', 'active', true), true);
  assert.equal(isTradeCreditEligible(true, true, 'approver', 'active', true), false);
});

void test('keeps flattened eligibility aliases valid when nested records are absent', () => {
  assert.deepEqual(
    evaluateTradeCreditEligibility({
      companyActive: true,
      membershipActive: true,
      membershipRole: 'buyer',
      creditState: 'active',
    }),
    { eligible: true },
  );
});

void test('fails closed when company active aliases conflict', () => {
  assert.deepEqual(
    evaluateTradeCreditEligibility({
      company: { id: '7', active: false },
      companyAccount: { id: '7', active: true },
      companyActive: true,
      membership: { companyId: '7', active: true, role: 'buyer' },
      creditAccount: { companyId: '7', state: 'active' },
    }),
    { eligible: false, code: 'NO_ACTIVE_COMPANY' },
  );
});

void test('fails closed when nested credit state and status aliases conflict', () => {
  assert.deepEqual(
    evaluateTradeCreditEligibility({
      company: { id: '7', active: true },
      membership: { companyId: '7', active: true, role: 'buyer' },
      creditAccount: { companyId: '7', state: 'active' },
      account: { companyId: '7', status: 'on_hold' },
      creditState: 'active',
    }),
    { eligible: false, code: 'CREDIT_ACCOUNT_NOT_ACTIVE' },
  );
});

void test('returns stable eligibility failure identities', () => {
  assert.deepEqual(evaluateTradeCreditEligibility({}), {
    eligible: false,
    code: 'NO_ACTIVE_COMPANY',
  });
  assert.deepEqual(evaluateTradeCreditEligibility({ companyActive: true }), {
    eligible: false,
    code: 'NO_ACTIVE_MEMBERSHIP',
  });
  assert.deepEqual(
    evaluateTradeCreditEligibility({
      companyActive: true,
      membershipActive: true,
      membershipRole: 'approver',
    }),
    { eligible: false, code: 'MEMBERSHIP_ROLE_NOT_ELIGIBLE' },
  );
  assert.deepEqual(
    evaluateTradeCreditEligibility({
      companyActive: true,
      membershipActive: true,
      membershipRole: 'buyer',
    }),
    { eligible: false, code: 'CREDIT_ACCOUNT_NOT_ACTIVE' },
  );
});

void test('calculates due date as exactly thirty UTC days', () => {
  const issuedAt = '2026-09-01T12:34:56.789Z';
  assert.equal(calculateInvoiceDueAt(issuedAt), '2026-10-01T12:34:56.789Z');
  assert.equal(TRADE_CREDIT_TERM_MS, TRADE_CREDIT_TERMS_DAYS * 24 * 60 * 60 * 1_000);
  assert.throws(() => calculateInvoiceDueAt('2026-02-30T00:00:00.000Z'), RangeError);
  assert.throws(() => calculateInvoiceDueAt('2026-09-01T12:34:56Z'), RangeError);
  assert.throws(() => calculateInvoiceDueAt('not-an-instant'), RangeError);
});

void test('derives open and overdue at the due boundary while terminal statuses stay stable', () => {
  const dueAt = '2026-10-01T00:00:00.000Z';
  assert.equal(deriveInvoiceLifecycleStatus(dueAt, '2026-09-30T23:59:59.999Z'), 'open');
  assert.equal(deriveInvoiceLifecycleStatus(dueAt, dueAt), 'overdue');
  assert.equal(deriveInvoiceLifecycleStatus({ dueAt, now: dueAt, status: 'paid' }), 'paid');
  assert.equal(deriveInvoiceLifecycleStatus({ dueAt, now: dueAt, status: 'voided' }), 'voided');
  assert.equal(
    deriveInvoiceLifecycleStatus({ dueAt, now: dueAt, lifecycle: { status: 'open' } }),
    'overdue',
  );
  assert.equal(isInvoiceOverdue(dueAt, dueAt), true);
  assert.throws(() => deriveInvoiceLifecycleStatus(dueAt, 'not-an-instant'), RangeError);
  assert.throws(
    () => deriveInvoiceLifecycleStatus({ dueAt: 'not-an-instant', now: dueAt }),
    RangeError,
  );
  assert.throws(
    () => deriveInvoiceLifecycleStatus({ dueAt, now: dueAt, status: 'unknown' as never }),
    RangeError,
  );
});
