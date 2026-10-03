import assert from 'node:assert/strict';
import test from 'node:test';
import { quoteDelivery } from '../../src/features/delivery/deliveryRules.js';
import { FREIGHT_WEIGHT_THRESHOLD_GRAMS } from '@shop/contracts/delivery';

void test('delivery rules', async (t) => {
  await t.test('empty cart returns parcel with zero weight', () => {
    const result = quoteDelivery([]);
    assert.equal(result.mode, 'parcel');
    assert.equal(result.chargeCents, 0);
    assert.equal(result.weightGrams, 0);
    assert.ok(result.reason.includes('under'));
  });

  await t.test('threshold minus one gram is parcel', () => {
    const weight = FREIGHT_WEIGHT_THRESHOLD_GRAMS - 1;
    const result = quoteDelivery([
      { deliveryClass: 'parcel', unitWeightGrams: weight, quantity: 1 },
    ]);
    assert.equal(result.mode, 'parcel');
    assert.equal(result.chargeCents, 0);
    assert.equal(result.weightGrams, weight);
  });

  await t.test('threshold exactly is freight', () => {
    const result = quoteDelivery([
      {
        deliveryClass: 'parcel',
        unitWeightGrams: FREIGHT_WEIGHT_THRESHOLD_GRAMS,
        quantity: 1,
      },
    ]);
    assert.equal(result.mode, 'freight');
    assert.equal(result.chargeCents, 999);
    assert.equal(result.weightGrams, FREIGHT_WEIGHT_THRESHOLD_GRAMS);
    assert.ok(result.reason.includes('meets or exceeds'));
  });

  await t.test('threshold plus one is freight', () => {
    const result = quoteDelivery([
      {
        deliveryClass: 'parcel',
        unitWeightGrams: FREIGHT_WEIGHT_THRESHOLD_GRAMS + 1,
        quantity: 1,
      },
    ]);
    assert.equal(result.mode, 'freight');
    assert.equal(result.chargeCents, 999);
  });

  await t.test('freight-class variant forces freight regardless of weight', () => {
    const result = quoteDelivery([{ deliveryClass: 'freight', unitWeightGrams: 100, quantity: 1 }]);
    assert.equal(result.mode, 'freight');
    assert.equal(result.chargeCents, 999);
    assert.equal(result.weightGrams, 100);
    assert.ok(result.reason.includes('freight-class item'));
  });

  await t.test('mixed parcel and freight class results in freight', () => {
    const result = quoteDelivery([
      { deliveryClass: 'parcel', unitWeightGrams: 100, quantity: 1 },
      { deliveryClass: 'freight', unitWeightGrams: 200, quantity: 1 },
    ]);
    assert.equal(result.mode, 'freight');
    assert.equal(result.chargeCents, 999);
    assert.equal(result.weightGrams, 300);
  });

  await t.test('multiple lines sum weights', () => {
    const result = quoteDelivery([
      { deliveryClass: 'parcel', unitWeightGrams: 20_000, quantity: 3 },
      { deliveryClass: 'parcel', unitWeightGrams: 30_000, quantity: 2 },
    ]);
    assert.equal(result.mode, 'freight');
    assert.equal(result.weightGrams, 120_000);
  });

  await t.test('large parcel order stays parcel', () => {
    const result = quoteDelivery([
      { deliveryClass: 'parcel', unitWeightGrams: 20_000, quantity: 4 },
    ]);
    assert.equal(result.mode, 'parcel');
    assert.equal(result.chargeCents, 0);
    assert.equal(result.weightGrams, 80_000);
  });

  await t.test('quantity multiplies unit weight correctly', () => {
    const result = quoteDelivery([
      { deliveryClass: 'parcel', unitWeightGrams: 25_000, quantity: 4 },
    ]);
    assert.equal(result.mode, 'freight');
    assert.equal(result.weightGrams, 100_000);
  });
});
