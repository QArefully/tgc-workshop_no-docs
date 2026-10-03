import assert from 'node:assert/strict';
import test from 'node:test';
import type { VariantRow } from '../catalog/productRepository.js';
import {
  SAVED_LIST_MAX_ITEMS,
  SAVED_LIST_MAX_PER_USER,
  assembleSavedListCartOutcomes,
  buildSavedListCartPlan,
  countSavedListOutcomes,
  normalizeSavedListName,
} from './savedListRules.js';

function variant(overrides: Partial<VariantRow> = {}): VariantRow {
  return {
    id: 7,
    product_id: 12,
    sku: 'CEM-001',
    label: '25 kg sack',
    weight_grams: 25_000,
    price_cents: 1_000,
    moq_sacks: 4,
    compare_at_price_cents: null,
    clearance_price_cents: null,
    clearance_starts_at: null,
    clearance_ends_at: null,
    stock_count: 10,
    backorderable: 0,
    backorder_lead_days: null,
    delivery_class: 'freight',
    active: 1,
    sort_order: 1,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}
function source(itemId: number, overrides: Partial<ReturnType<typeof sourceBase>> = {}) {
  return { ...sourceBase(itemId), ...overrides };
}
function sourceBase(itemId: number) {
  return {
    itemId,
    variantId: 7,
    sku: 'CEM-001',
    productId: '12',
    productName: 'Cement',
    quantity: 1,
    variant: variant(),
  };
}

void test('normalises whitespace and enforces name bounds and caps', () => {
  assert.equal(normalizeSavedListName('  Restock   yard  '), 'Restock yard');
  assert.equal(normalizeSavedListName('   '), null);
  assert.equal(normalizeSavedListName('x'.repeat(81)), null);
  assert.equal(SAVED_LIST_MAX_PER_USER, 25);
  assert.equal(SAVED_LIST_MAX_ITEMS, 200);
});

void test('MOQ plans exact, one below, and one above quantities', () => {
  const plan = buildSavedListCartPlan([
    source(1, { quantity: 4 }),
    source(2, { quantity: 3 }),
    source(3, { quantity: 5 }),
  ]);
  assert.deepEqual(
    plan.requests.map((request) => request.quantity),
    [4, 4, 5],
  );
  assert.deepEqual(
    [...plan.moqAdjustedByItemId.entries()],
    [
      [1, false],
      [2, true],
      [3, false],
    ],
  );
});

void test('overflow and retired variants are pre-skipped before cart submission', () => {
  const plan = buildSavedListCartPlan([
    source(1, { quantity: Number.MAX_SAFE_INTEGER, variant: variant() }),
    source(2, { variant: variant({ active: 0 }) }),
  ]);
  assert.deepEqual(plan.requests, []);
  assert.deepEqual(
    [...plan.preSkips.entries()],
    [
      [1, 'INVALID_QUANTITY'],
      [2, 'VARIANT_RETIRED'],
    ],
  );
});

void test('outcomes retain item order and one result per item', () => {
  const items = [source(9), source(4, { variant: variant({ active: 0 }) }), source(5)];
  const plan = buildSavedListCartPlan(items);
  const outcomes = assembleSavedListCartOutcomes(items, plan, [
    { key: '9', status: 'added', resultingQuantity: 4, resolvedUnitPriceCents: 999 },
    { key: '5', status: 'skipped', reason: 'INSUFFICIENT_STOCK' },
  ]);
  assert.deepEqual(
    outcomes.map((outcome) => [outcome.itemId, outcome.status, outcome.reason]),
    [
      ['9', 'added', null],
      ['4', 'skipped', 'VARIANT_RETIRED'],
      ['5', 'skipped', 'INSUFFICIENT_STOCK'],
    ],
  );
  assert.deepEqual(countSavedListOutcomes(outcomes), { addedLineCount: 1, skippedLineCount: 2 });
});
