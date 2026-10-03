import assert from 'node:assert/strict';
import test from 'node:test';
import { countryProfile, type CountryProfile } from '@shop/contracts/country-profiles';
import {
  blockedCategoriesFor,
  blockedSlugsFor,
  isCategoryBlocked,
  isProductBlocked,
} from './availabilityRules.js';

const cnProfile = countryProfile('CN');
const productBlockedProfile: CountryProfile = {
  ...countryProfile('US'),
  blockedProductSlugs: ['restricted-lot'],
};

void test('category availability follows the profile exclusion list', () => {
  assert.equal(isCategoryBlocked(cnProfile, 'Sports Nutrition'), true);
  assert.equal(isCategoryBlocked(cnProfile, 'Baking & Pantry'), false);
  assert.deepEqual(blockedCategoriesFor(cnProfile), ['Sports Nutrition']);
});

void test('product availability follows the profile exclusion list', () => {
  assert.equal(isProductBlocked(productBlockedProfile, 'restricted-lot'), true);
  assert.equal(isProductBlocked(productBlockedProfile, 'available-lot'), false);
  assert.deepEqual(blockedSlugsFor(productBlockedProfile), ['restricted-lot']);
});
