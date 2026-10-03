import assert from 'node:assert/strict';
import test from 'node:test';

import { isEligibleForPromo } from './cartValidation.js';

void test('promo eligibility starts at five items', () => {
  assert.equal(isEligibleForPromo(4), false);
  assert.equal(isEligibleForPromo(5), true);
});
