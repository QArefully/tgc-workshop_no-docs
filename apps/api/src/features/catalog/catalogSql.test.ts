import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCatalogQuery } from './catalogQuery.js';
import { availableToSellSql, buildCatalogPredicate } from './catalogSql.js';

void test('availability predicates use one bound time and fixed SQL identifiers', () => {
  const now = '2026-07-19T12:00:00.000Z';
  const predicate = buildCatalogPredicate(
    normalizeCatalogQuery({ availability: 'backorder', sort: 'newest' }),
    now,
  );

  assert.match(availableToSellSql, /inventory_reservations/);
  assert.match(predicate.where, /p\.backorderable = 1/);
  assert.match(predicate.where, /r\.expires_at > \?/);
  assert.deepEqual(predicate.params, [now]);
  assert.equal(predicate.where.includes('stock_count > 0'), false);
});
