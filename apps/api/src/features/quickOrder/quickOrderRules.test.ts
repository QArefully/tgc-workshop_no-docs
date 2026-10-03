import assert from 'node:assert/strict';
import test from 'node:test';
import type { VariantWithProductRow } from '../catalog/productRepository.js';
import type { BulkAddOutcome } from '../cart/cartBulkAddRules.js';
import {
  assembleQuickOrderOutcomes,
  buildQuickOrderDemand,
  countQuickOrderOutcomes,
  parseQuickOrderText,
  toQuickOrderBulkAddRequests,
  type ParsedQuickOrderLine,
} from './quickOrderRules.js';

function variant(overrides: Partial<VariantWithProductRow> = {}): VariantWithProductRow {
  return {
    id: 7,
    product_id: 12,
    sku: 'CEM-0001-001',
    label: '25 kg sack',
    weight_grams: 25_000,
    price_cents: 1_000,
    moq_sacks: 4,
    compare_at_price_cents: null,
    clearance_price_cents: null,
    clearance_starts_at: null,
    clearance_ends_at: null,
    stock_count: 100,
    backorderable: 0,
    backorder_lead_days: null,
    delivery_class: 'freight',
    active: 1,
    sort_order: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    product_name: 'Portland Cement',
    ...overrides,
  };
}

function outcomesFor(
  lines: readonly ParsedQuickOrderLine[],
  groups: ReturnType<typeof buildQuickOrderDemand>,
  bulkOutcomes: readonly BulkAddOutcome[],
  variants: ReadonlyMap<string, VariantWithProductRow>,
) {
  return assembleQuickOrderOutcomes(lines, groups, bulkOutcomes, variants);
}

void test('CRLF normalisation keeps physical line numbers and drops blank lines', () => {
  const lines = parseQuickOrderText('\r\ncem-0001-001, 4\r\n \rSPN-0002-001 5\r');

  assert.deepEqual(
    lines.map((line) => [line.lineNumber, line.sku, line.requestedQuantity]),
    [
      [2, 'CEM-0001-001', 4],
      [4, 'SPN-0002-001', 5],
    ],
  );
});

void test('parser accepts comma, semicolon, tab, and whitespace delimiters', () => {
  const lines = parseQuickOrderText(
    'CEM-0001-001,4\nLIM-0001-001; 5\nGYP-0001-001\t6\nSND-0001-001 7',
  );

  assert.deepEqual(
    lines.map((line) => [line.sku, line.requestedQuantity, line.preSkipReason]),
    [
      ['CEM-0001-001', 4, null],
      ['LIM-0001-001', 5, null],
      ['GYP-0001-001', 6, null],
      ['SND-0001-001', 7, null],
    ],
  );
});

void test('malformed token forms do not expose a partial SKU', () => {
  const lines = parseQuickOrderText('CEM-0001-001, 4, extra\n, 4\n' + 'A'.repeat(65) + ', 4');

  assert.deepEqual(
    lines.map((line) => [line.sku, line.requestedQuantity, line.preSkipReason]),
    [
      [null, null, 'MALFORMED_LINE'],
      [null, null, 'MALFORMED_LINE'],
      [null, null, 'MALFORMED_LINE'],
    ],
  );
});

void test('bad quantity forms are classified as invalid quantities', () => {
  const lines = parseQuickOrderText(
    ['4.5', '-1', '0', 'abc', '1e3'].map((quantity) => `cem-0001-001, ${quantity}`).join('\n'),
  );

  assert.deepEqual(
    lines.map((line) => [line.sku, line.requestedQuantity, line.preSkipReason]),
    [
      ['CEM-0001-001', null, 'INVALID_QUANTITY'],
      ['CEM-0001-001', null, 'INVALID_QUANTITY'],
      ['CEM-0001-001', null, 'INVALID_QUANTITY'],
      ['CEM-0001-001', null, 'INVALID_QUANTITY'],
      ['CEM-0001-001', null, 'INVALID_QUANTITY'],
    ],
  );
});

void test('lowercase SKUs normalise before exact lookup', () => {
  const lines = parseQuickOrderText('cem-0001-001, 4');
  const cement = variant();
  const groups = buildQuickOrderDemand(lines, new Map([[cement.sku, cement]]));

  assert.equal(groups[0]?.sku, 'CEM-0001-001');
  assert.deepEqual(toQuickOrderBulkAddRequests(groups), [
    { key: 'CEM-0001-001', variantId: cement.id, quantity: 4 },
  ]);
});

void test('unknown duplicate SKUs receive SKU_NOT_FOUND on every contributing line', () => {
  const lines = parseQuickOrderText('UNK-0001-001, 2\nunk-0001-001, 3');
  const groups = buildQuickOrderDemand(lines, new Map());
  const outcomes = outcomesFor(lines, groups, [], new Map());

  assert.equal(groups.length, 1);
  assert.deepEqual(
    outcomes.map((outcome) => [outcome.reason, outcome.duplicateSku, outcome.submittedQuantity]),
    [
      ['SKU_NOT_FOUND', true, 5],
      ['SKU_NOT_FOUND', true, 5],
    ],
  );
});

void test('duplicate SKU demand aggregates once and reports each source line', () => {
  const cement = variant();
  const variants = new Map([[cement.sku, cement]]);
  const lines = parseQuickOrderText('CEM-0001-001, 2\nCEM-0001-001, 2');
  const groups = buildQuickOrderDemand(lines, variants);

  assert.deepEqual(
    groups.map((group) => [
      group.sku,
      group.requestedQuantity,
      group.submittedQuantity,
      group.lines.length,
    ]),
    [['CEM-0001-001', 4, 4, 2]],
  );
  assert.deepEqual(toQuickOrderBulkAddRequests(groups), [
    { key: cement.sku, variantId: cement.id, quantity: 4 },
  ]);
});

void test('MOQ rounds one sack to four, but does not adjust aggregated two plus two', () => {
  const cement = variant();
  const variants = new Map([[cement.sku, cement]]);
  const one = buildQuickOrderDemand(parseQuickOrderText('CEM-0001-001, 1'), variants);
  const twoPlusTwo = buildQuickOrderDemand(
    parseQuickOrderText('CEM-0001-001, 2\nCEM-0001-001, 2'),
    variants,
  );

  assert.deepEqual([one[0]?.submittedQuantity, one[0]?.moqAdjusted], [4, true]);
  assert.deepEqual([twoPlusTwo[0]?.submittedQuantity, twoPlusTwo[0]?.moqAdjusted], [4, false]);
});

void test('retired and unusable MOQ data receive no adjustment and never throw', () => {
  const retired = variant({ sku: 'RET-0001-001', active: 0 });
  const unusableWeight = variant({ sku: 'BAD-0001-001', weight_grams: 0 });
  const unusableMoq = variant({ sku: 'BAD-0002-001', moq_sacks: 0 });
  const variants = new Map([
    [retired.sku, retired],
    [unusableWeight.sku, unusableWeight],
    [unusableMoq.sku, unusableMoq],
  ]);
  const groups = buildQuickOrderDemand(
    parseQuickOrderText('RET-0001-001, 1\nBAD-0001-001, 1\nBAD-0002-001, 1'),
    variants,
  );

  assert.deepEqual(
    groups.map((group) => [group.submittedQuantity, group.moqAdjusted]),
    [
      [1, false],
      [1, false],
      [1, false],
    ],
  );
});

void test('safe-integer aggregation overflow is invalid for every group member', () => {
  const cement = variant();
  const variants = new Map([[cement.sku, cement]]);
  const lines = parseQuickOrderText(`CEM-0001-001, ${Number.MAX_SAFE_INTEGER}\nCEM-0001-001, 1`);
  const groups = buildQuickOrderDemand(lines, variants);
  const outcomes = outcomesFor(lines, groups, [], variants);

  assert.equal(groups[0]?.preSkipReason, 'INVALID_QUANTITY');
  assert.deepEqual(
    outcomes.map((outcome) => outcome.reason),
    ['INVALID_QUANTITY', 'INVALID_QUANTITY'],
  );
});

void test('a cart group verdict fans out to every member and counts source lines', () => {
  const cement = variant();
  const variants = new Map([[cement.sku, cement]]);
  const lines = parseQuickOrderText('CEM-0001-001, 2\nCEM-0001-001, 2');
  const groups = buildQuickOrderDemand(lines, variants);
  const outcomes = outcomesFor(
    lines,
    groups,
    [{ key: cement.sku, status: 'added', resultingQuantity: 4, resolvedUnitPriceCents: 950 }],
    variants,
  );

  assert.deepEqual(
    outcomes.map((outcome) => [
      outcome.status,
      outcome.duplicateSku,
      outcome.resolvedUnitPriceCents,
    ]),
    [
      ['added', true, 950],
      ['added', true, 950],
    ],
  );
  assert.deepEqual(countQuickOrderOutcomes(outcomes), { addedLineCount: 2, skippedLineCount: 0 });
});

void test('Quick Order preserves the cart country-blocking precedence verdict', () => {
  const cement = variant();
  const variants = new Map([[cement.sku, cement]]);
  const lines = parseQuickOrderText('CEM-0001-001, 4');
  const groups = buildQuickOrderDemand(lines, variants);
  const outcomes = outcomesFor(
    lines,
    groups,
    [{ key: cement.sku, status: 'skipped', reason: 'BLOCKED_IN_COUNTRY' }],
    variants,
  );

  assert.equal(outcomes[0]?.reason, 'BLOCKED_IN_COUNTRY');
});

void test('a submitted group without a cart outcome is an invariant breach', () => {
  const cement = variant();
  const variants = new Map([[cement.sku, cement]]);
  const lines = parseQuickOrderText('CEM-0001-001, 4');
  const groups = buildQuickOrderDemand(lines, variants);

  assert.throws(
    () => outcomesFor(lines, groups, [], variants),
    /submitted but has no cart outcome/,
  );
});
