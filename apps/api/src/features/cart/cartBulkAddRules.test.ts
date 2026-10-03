import assert from 'node:assert/strict';
import test from 'node:test';
import type { CustomBlendSnapshot } from '@shop/contracts';
import {
  BULK_ADD_SKIP_REASONS,
  aggregateBulkAddDemand,
  classifyBulkAddGroup as classifyBulkAddGroupRule,
  fanOutBulkAddOutcome,
  type BulkAddRequest,
  type ClassifyBulkAddGroupInput,
  type BulkAddVariantRow,
} from './cartBulkAddRules.js';
import { resolveUnitPriceCents } from '../pricing/pricingRules.js';

const NOW = new Date('2026-07-31T12:00:00.000Z');
const SACK_GRAMS = 25_000;

function classifyBulkAddGroup(
  input: Omit<ClassifyBulkAddGroupInput, 'blockedInCountry'> & { blockedInCountry?: boolean },
) {
  return classifyBulkAddGroupRule({ blockedInCountry: false, ...input });
}

function variantRow(overrides: Partial<BulkAddVariantRow> = {}): BulkAddVariantRow {
  return {
    id: 7,
    weight_grams: SACK_GRAMS,
    price_cents: 10_000,
    moq_sacks: 4,
    active: 1,
    clearance_price_cents: null,
    clearance_starts_at: null,
    clearance_ends_at: null,
    ...overrides,
  };
}

function blend(configKey: string): CustomBlendSnapshot {
  return {
    configKey,
    basePercentage: 80,
    mixingGroup: 'cement',
    ingredients: [
      {
        variantId: 21,
        productId: '11',
        productName: 'Filler',
        productDescription: 'Filler',
        mixingGroup: 'cement',
        percentage: 20,
      },
    ],
    blendingFeeCents: 2_500,
    madeToOrder: true,
    returnable: false,
  };
}

function request(overrides: Partial<BulkAddRequest> & { key: string }): BulkAddRequest {
  return { variantId: 7, quantity: 4, ...overrides };
}

void test('aggregation merges duplicate variant and config identities in submission order', () => {
  const groups = aggregateBulkAddDemand([
    request({ key: 'a', variantId: 7, quantity: 2 }),
    request({ key: 'b', variantId: 9, quantity: 5 }),
    request({ key: 'c', variantId: 7, quantity: 3 }),
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups.map((group) => [group.variantId, group.configKey, group.requestedQuantity, group.keys]),
    [
      [7, '', 5, ['a', 'c']],
      [9, '', 5, ['b']],
    ],
  );
});

void test('aggregation keeps different config keys on the same variant apart', () => {
  const groups = aggregateBulkAddDemand([
    request({ key: 'plain', variantId: 7, quantity: 1 }),
    request({ key: 'mix-1', variantId: 7, quantity: 2, customBlend: blend('aaa') }),
    request({ key: 'mix-2', variantId: 7, quantity: 3, customBlend: blend('aaa') }),
    request({ key: 'mix-3', variantId: 7, quantity: 4, customBlend: blend('bbb') }),
  ]);
  assert.deepEqual(
    groups.map((group) => [group.configKey, group.requestedQuantity, group.keys.length]),
    [
      ['', 1, 1],
      ['aaa', 5, 2],
      ['bbb', 4, 1],
    ],
  );
  assert.equal(groups[1]?.customBlend?.configKey, 'aaa');
});

void test('country blocking outranks retirement, stock, MOQ, and quantity failures', () => {
  assert.deepEqual(BULK_ADD_SKIP_REASONS, [
    'BLOCKED_IN_COUNTRY',
    'VARIANT_RETIRED',
    'BLEND_UNAVAILABLE',
    'INVALID_QUANTITY',
    'INSUFFICIENT_STOCK',
    'BELOW_MOQ',
  ]);
  const cases: Array<Omit<ClassifyBulkAddGroupInput, 'blockedInCountry' | 'now'>> = [
    {
      variantRow: variantRow({ active: 0 }),
      existingQuantity: 0,
      requestedQuantity: 4,
      availability: { availableToSell: 100, backorderable: false },
    },
    {
      variantRow: variantRow(),
      existingQuantity: 0,
      requestedQuantity: 4,
      availability: { availableToSell: 0, backorderable: false },
    },
    {
      variantRow: variantRow({ moq_sacks: 40 }),
      existingQuantity: 0,
      requestedQuantity: 4,
      availability: { availableToSell: 100, backorderable: false },
    },
    {
      variantRow: variantRow(),
      existingQuantity: 0,
      requestedQuantity: 0,
      availability: { availableToSell: 100, backorderable: false },
    },
  ];

  for (const input of cases) {
    assert.deepEqual(classifyBulkAddGroup({ ...input, blockedInCountry: true, now: NOW }), {
      status: 'skipped',
      reason: 'BLOCKED_IN_COUNTRY',
    });
  }
});

void test('retired or missing variant outranks every other skip reason', () => {
  for (const row of [undefined, variantRow({ active: 0 })]) {
    assert.deepEqual(
      classifyBulkAddGroup({
        variantRow: row,
        existingQuantity: 0,
        requestedQuantity: 0,
        availability: { availableToSell: 0, backorderable: false },
        blendValid: false,
        now: NOW,
      }),
      { status: 'skipped', reason: 'VARIANT_RETIRED' },
    );
  }
});

void test('unavailable blend outranks quantity, stock, and MOQ problems', () => {
  assert.deepEqual(
    classifyBulkAddGroup({
      variantRow: variantRow(),
      existingQuantity: 0,
      requestedQuantity: 0,
      availability: { availableToSell: 0, backorderable: false },
      blendValid: false,
      now: NOW,
    }),
    { status: 'skipped', reason: 'BLEND_UNAVAILABLE' },
  );
});

void test('invalid quantity outranks stock and MOQ problems', () => {
  for (const requestedQuantity of [0, -3, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER]) {
    assert.deepEqual(
      classifyBulkAddGroup({
        variantRow: variantRow(),
        existingQuantity: 0,
        requestedQuantity,
        availability: { availableToSell: 0, backorderable: false },
        blendValid: true,
        now: NOW,
      }),
      { status: 'skipped', reason: 'INVALID_QUANTITY' },
    );
  }
});

void test('insufficient stock outranks a MOQ shortfall', () => {
  assert.deepEqual(
    classifyBulkAddGroup({
      variantRow: variantRow({ moq_sacks: 40 }),
      existingQuantity: 0,
      requestedQuantity: 2,
      availability: { availableToSell: 1, backorderable: false },
      now: NOW,
    }),
    { status: 'skipped', reason: 'INSUFFICIENT_STOCK' },
  );
});

void test('stock is judged on cumulative quantity at the exact boundary', () => {
  const atBoundary = classifyBulkAddGroup({
    variantRow: variantRow(),
    existingQuantity: 2,
    requestedQuantity: 4,
    availability: { availableToSell: 6, backorderable: false },
    now: NOW,
  });
  assert.equal(atBoundary.status, 'added');
  assert.deepEqual(
    classifyBulkAddGroup({
      variantRow: variantRow(),
      existingQuantity: 2,
      requestedQuantity: 4,
      availability: { availableToSell: 5, backorderable: false },
      now: NOW,
    }),
    { status: 'skipped', reason: 'INSUFFICIENT_STOCK' },
  );
});

void test('backorderable variants ignore the stock shortfall entirely', () => {
  const classification = classifyBulkAddGroup({
    variantRow: variantRow(),
    existingQuantity: 0,
    requestedQuantity: 4,
    availability: { availableToSell: 0, backorderable: true },
    now: NOW,
  });
  assert.deepEqual(classification, {
    status: 'added',
    resultingQuantity: 4,
    resolvedUnitPriceCents: 10_000,
  });
});

void test('missing availability facts block a non-backorderable variant', () => {
  assert.deepEqual(
    classifyBulkAddGroup({
      variantRow: variantRow(),
      existingQuantity: 0,
      requestedQuantity: 4,
      availability: undefined,
      now: NOW,
    }),
    { status: 'skipped', reason: 'INSUFFICIENT_STOCK' },
  );
});

void test('MOQ is judged on post-add cumulative quantity at the exact minimum', () => {
  const availability = { availableToSell: 1_000, backorderable: false };
  assert.deepEqual(
    classifyBulkAddGroup({
      variantRow: variantRow({ moq_sacks: 4 }),
      existingQuantity: 1,
      requestedQuantity: 3,
      availability,
      now: NOW,
    }),
    { status: 'added', resultingQuantity: 4, resolvedUnitPriceCents: 10_000 },
  );
  assert.deepEqual(
    classifyBulkAddGroup({
      variantRow: variantRow({ moq_sacks: 4 }),
      existingQuantity: 1,
      requestedQuantity: 2,
      availability,
      now: NOW,
    }),
    { status: 'skipped', reason: 'BELOW_MOQ' },
  );
});

void test('a below-MOQ line is never raised to the MOQ floor', () => {
  const classification = classifyBulkAddGroup({
    variantRow: variantRow({ moq_sacks: 4 }),
    existingQuantity: 0,
    requestedQuantity: 1,
    availability: { availableToSell: 1_000, backorderable: false },
    now: NOW,
  });
  assert.equal(classification.status, 'skipped');
  assert.equal('resultingQuantity' in classification, false);
});

void test('added price resolves clearance first, then the tonne tier ladder', () => {
  const quantity = 200; // 5 tonnes at 25 kg per sack qualifies for a tier discount.
  const row = variantRow({
    clearance_price_cents: 8_000,
    clearance_starts_at: '2026-07-30T00:00:00.000Z',
    clearance_ends_at: '2026-08-02T00:00:00.000Z',
  });
  const classification = classifyBulkAddGroup({
    variantRow: row,
    existingQuantity: 0,
    requestedQuantity: quantity,
    availability: { availableToSell: quantity, backorderable: false },
    now: NOW,
  });
  const expected = resolveUnitPriceCents(8_000, quantity, SACK_GRAMS);
  assert.ok(expected < 8_000);
  assert.deepEqual(classification, {
    status: 'added',
    resultingQuantity: quantity,
    resolvedUnitPriceCents: expected,
  });
});

void test('configured groups use resolver component pricing instead of base-only pricing', () => {
  const classification = classifyBulkAddGroup({
    variantRow: variantRow({ price_cents: 1_000 }),
    existingQuantity: 0,
    requestedQuantity: 4,
    availability: { availableToSell: 4, backorderable: false },
    blendValid: true,
    resolvedBlend: { materialUnitPriceCents: 1_250 },
    now: NOW,
  });
  assert.deepEqual(classification, {
    status: 'added',
    resultingQuantity: 4,
    resolvedUnitPriceCents: 1_250,
  });
});

void test('configured policy skips retain resolver pricing while unavailable blends stay unpriced', () => {
  const resolvedBlend = { materialUnitPriceCents: 1_250 };
  const baseInput = {
    variantRow: variantRow(),
    existingQuantity: 0,
    requestedQuantity: 4,
    availability: { availableToSell: 4, backorderable: false },
    blendValid: true,
    resolvedBlend,
    now: NOW,
  };

  assert.deepEqual(classifyBulkAddGroup({ ...baseInput, blockedInCountry: true }), {
    status: 'skipped',
    reason: 'BLOCKED_IN_COUNTRY',
    resolvedUnitPriceCents: 1_250,
  });
  assert.deepEqual(
    classifyBulkAddGroup({
      ...baseInput,
      availability: { availableToSell: 0, backorderable: false },
    }),
    {
      status: 'skipped',
      reason: 'INSUFFICIENT_STOCK',
      resolvedUnitPriceCents: 1_250,
    },
  );
  assert.deepEqual(
    classifyBulkAddGroup({
      ...baseInput,
      variantRow: variantRow({ moq_sacks: 40 }),
      availability: { availableToSell: 4, backorderable: false },
    }),
    {
      status: 'skipped',
      reason: 'BELOW_MOQ',
      resolvedUnitPriceCents: 1_250,
    },
  );
  assert.deepEqual(classifyBulkAddGroup({ ...baseInput, blendValid: false }), {
    status: 'skipped',
    reason: 'BLEND_UNAVAILABLE',
  });
});

void test('an expired clearance window falls back to the list price', () => {
  const classification = classifyBulkAddGroup({
    variantRow: variantRow({
      clearance_price_cents: 8_000,
      clearance_starts_at: '2026-07-01T00:00:00.000Z',
      clearance_ends_at: '2026-07-15T00:00:00.000Z',
    }),
    existingQuantity: 0,
    requestedQuantity: 4,
    availability: { availableToSell: 4, backorderable: false },
    now: NOW,
  });
  assert.deepEqual(classification, {
    status: 'added',
    resultingQuantity: 4,
    resolvedUnitPriceCents: 10_000,
  });
});

void test('a corrupt MOQ configuration is reported as an invalid quantity, never thrown', () => {
  assert.deepEqual(
    classifyBulkAddGroup({
      variantRow: variantRow({ moq_sacks: 0 }),
      existingQuantity: 0,
      requestedQuantity: 4,
      availability: { availableToSell: 4, backorderable: false },
      now: NOW,
    }),
    { status: 'skipped', reason: 'INVALID_QUANTITY' },
  );
});

void test('one group classification fans back out to every caller key', () => {
  const group = aggregateBulkAddDemand([
    request({ key: 'first', quantity: 2 }),
    request({ key: 'second', quantity: 2 }),
  ])[0]!;
  assert.deepEqual(
    fanOutBulkAddOutcome(group, {
      status: 'added',
      resultingQuantity: 4,
      resolvedUnitPriceCents: 10_000,
    }),
    [
      { key: 'first', status: 'added', resultingQuantity: 4, resolvedUnitPriceCents: 10_000 },
      { key: 'second', status: 'added', resultingQuantity: 4, resolvedUnitPriceCents: 10_000 },
    ],
  );
  assert.deepEqual(fanOutBulkAddOutcome(group, { status: 'skipped', reason: 'BELOW_MOQ' }), [
    { key: 'first', status: 'skipped', reason: 'BELOW_MOQ' },
    { key: 'second', status: 'skipped', reason: 'BELOW_MOQ' },
  ]);
});
