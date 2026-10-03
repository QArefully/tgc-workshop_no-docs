import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProductSpecificationGroup, ProductTag } from '@shop/contracts/products';
import {
  rankSimilarProducts,
  scoreProductSimilarity,
} from '../../src/features/catalog/productSimilarity.js';
import {
  createProductRepository,
  type CustomerProductRow,
} from '../../src/features/catalog/productRepository.js';
import { openSeededDatabase } from '../support/seededDatabase.js';

function product(id: number, overrides: Partial<CustomerProductRow> = {}): CustomerProductRow {
  return {
    id,
    name: `Product ${id}`,
    description: 'Test product',
    price_cents: 100,
    category: 'Test',
    stock_count: 1,
    image_set_id: null,
    slug: `product-${id}`,
    compare_at_price_cents: null,
    sales_count: 0,
    active: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    tags: [],
    specificationGroups: [],
    ...overrides,
  };
}

function tags(...keys: string[]): ProductTag[] {
  return keys.map((key) => ({ key, label: key }));
}

function specifications(
  facts: Array<[key: string, valueKey: string]>,
): ProductSpecificationGroup[] {
  return [
    {
      key: 'appearance',
      label: 'Appearance',
      order: 1,
      specifications: facts.map(([key, valueKey]) => ({
        key,
        label: key,
        valueKey,
        value: valueKey,
      })),
    },
  ];
}

void test('similarity scores exact components, caps repeated metadata, and honors price boundaries', () => {
  const source = product(1, {
    tags: tags('one', 'two', 'three', 'four', 'five'),
    specificationGroups: specifications([
      ['texture', 'fine'],
      ['colour', 'red'],
      ['source', 'plant'],
      ['intended-use', 'drink'],
      ['texture', 'fine'],
    ]),
  });
  const full = scoreProductSimilarity(
    source,
    product(2, {
      tags: tags('one', 'two', 'three', 'four', 'five', 'five'),
      specificationGroups: specifications([
        ['texture', 'fine'],
        ['colour', 'red'],
        ['source', 'plant'],
        ['intended-use', 'drink'],
        ['texture', 'fine'],
      ]),
    }),
  );
  assert.deepEqual(full, {
    category: 40,
    tags: 20,
    specifications: 20,
    price: 15,
    availability: 5,
    total: 100,
    priceDifferenceCents: 0,
  });

  for (const [priceCents, expected] of [
    [110, 15],
    [111, 10],
    [125, 10],
    [126, 5],
    [150, 5],
    [151, 0],
  ]) {
    assert.equal(
      scoreProductSimilarity(source, product(priceCents, { price_cents: priceCents }))?.price,
      expected,
    );
  }
  assert.equal(
    scoreProductSimilarity(product(1, { price_cents: 0 }), product(2, { price_cents: 1 }))?.price,
    0,
  );
});

void test('similarity eligibility and complete ordering stay deterministic', () => {
  const source = product(1, { category: 'Source', price_cents: 100, tags: tags('shared') });
  const candidates = [
    product(9, { category: 'Source', price_cents: 150, stock_count: 0 }),
    product(8, { category: 'Source', price_cents: 150, stock_count: 1 }),
    product(7, { category: 'Source', price_cents: 150, stock_count: 1 }),
    product(6, { category: 'Other', price_cents: 100, tags: tags('shared') }),
    product(5, { category: 'Other', price_cents: 200 }),
    product(4, { category: 'Source', active: 0 }),
    source,
  ];
  assert.deepEqual(
    rankSimilarProducts(source, candidates).map((candidate) => candidate.id),
    [7, 8, 9, 6],
  );
  assert.equal(scoreProductSimilarity(source, candidates[4]), undefined);
  assert.equal(scoreProductSimilarity(source, candidates[5]), undefined);
  assert.equal(scoreProductSimilarity(source, source), undefined);
});

void test('similarity availability score uses reservation-aware stock projection', () => {
  const source = product(1, { category: 'Source', price_cents: 100 });
  const reserved = product(2, {
    category: 'Source',
    price_cents: 100,
    stock_count: 1,
    available_to_sell: 0,
  });
  const available = product(3, {
    category: 'Source',
    price_cents: 100,
    stock_count: 0,
    available_to_sell: 1,
  });

  assert.equal(scoreProductSimilarity(source, reserved)?.availability, 0);
  assert.equal(scoreProductSimilarity(source, available)?.availability, 5);
  assert.deepEqual(
    rankSimilarProducts(source, [reserved, available]).map((candidate) => candidate.id),
    [3, 2],
  );
});

void test('similarity limits after stable ranking and repository candidates omit inactive/source rows', (t) => {
  const { db } = openSeededDatabase(t);
  const repository = createProductRepository(db);
  const source = repository.findActiveById(1);
  assert.ok(source);
  db.prepare('UPDATE products SET active = 0 WHERE id = 2').run();
  const candidates = repository.listActiveCandidatesExcluding(source.id);
  assert.equal(
    candidates.some((candidate) => candidate.id === source.id || candidate.id === 2),
    false,
  );

  const six = Array.from({ length: 6 }, (_, index) =>
    product(index + 2, { category: source.category, price_cents: source.price_cents }),
  );
  assert.deepEqual(
    rankSimilarProducts(source, six).map((candidate) => candidate.id),
    [2, 3, 4, 5, 6],
  );
});
