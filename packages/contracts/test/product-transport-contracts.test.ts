import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import {
  Product,
  ProductComparisonQuery,
  ProductComparisonResponse,
  ProductFilterOptionsResponse,
  ProductQuery,
  SimilarProductsResponse,
  ProductSpecificationGroup,
  ProductTag,
} from '../src/products.js';

const productMetadata = {
  createdAt: '2026-07-14T00:00:00.000Z',
  available: true,
  tags: [{ key: 'high-protein', label: 'High protein' }],
  specificationGroups: [
    {
      key: 'appearance',
      label: 'Appearance',
      order: 1,
      specifications: [{ key: 'texture', label: 'Texture', valueKey: 'fine', value: 'Fine' }],
    },
  ],
};
const product = {
  id: '1',
  name: 'Protein Powder',
  description: 'A test product',
  priceCents: 2500,
  imageSetId: 'protein-powder',
  category: 'Performance',
  stock: 5,
  availability: 'in_stock',
  backorderable: false,
  backorderLeadDays: null,
  slug: 'protein-powder',
  salesCount: 10,
  ...productMetadata,
};

void test('product metadata requires normalized keys, UTC timestamps, and grouped facts', () => {
  assert.equal(Value.Check(Product, product), true);
  assert.equal(Value.Check(Product, { ...product, createdAt: '2026-07-14 00:00:00' }), false);
  assert.equal(
    Value.Check(Product, { ...product, tags: [{ key: 'High Protein', label: 'High protein' }] }),
    false,
  );
  assert.equal(
    Value.Check(ProductSpecificationGroup, {
      ...productMetadata.specificationGroups[0],
      specifications: [
        { key: 'texture', label: 'Texture', valueKey: 'fine-grained', value: 'Fine grained' },
      ],
    }),
    true,
  );
  assert.equal(
    Value.Check(ProductSpecificationGroup, {
      ...productMetadata.specificationGroups[0],
      specifications: [{ key: 'texture', label: 'Texture', value: 'Fine' }],
    }),
    false,
  );
});

void test('product metadata schemas reject raw active state and extra properties', () => {
  assert.equal(Value.Check(Product, { ...product, active: true }), false);
  assert.equal(
    Value.Check(ProductTag, { key: 'high-protein', label: 'High protein', active: true }),
    false,
  );
  assert.equal(
    Value.Check(Product, {
      ...product,
      specificationGroups: [
        {
          ...productMetadata.specificationGroups[0],
          specifications: [
            { ...productMetadata.specificationGroups[0].specifications[0], numericValue: 500 },
          ],
        },
      ],
    }),
    false,
  );
});

void test('filter options expose strict tag and grouped filterable specification values', () => {
  const options = {
    tags: [
      { key: 'high-protein', label: 'High protein' },
      { key: 'vegetarian', label: 'Vegetarian' },
    ],
    specificationGroups: [
      {
        key: 'appearance',
        label: 'Appearance',
        order: 1,
        specifications: [
          { key: 'texture', label: 'Texture', values: [{ key: 'fine', label: 'Fine' }] },
        ],
      },
    ],
  };
  assert.equal(Value.Check(ProductFilterOptionsResponse, options), true);
  assert.equal(
    Value.Check(ProductFilterOptionsResponse, {
      ...options,
      specificationGroups: [{ ...options.specificationGroups[0], active: true }],
    }),
    false,
  );
  assert.equal(
    Value.Check(ProductFilterOptionsResponse, {
      ...options,
      specificationGroups: [
        {
          ...options.specificationGroups[0],
          specifications: [{ ...options.specificationGroups[0].specifications[0], values: [] }],
        },
      ],
    }),
    false,
  );
});

void test('catalog query transport accepts bounded repeated discovery filters', () => {
  assert.equal(
    Value.Check(ProductQuery, {
      minPriceCents: 0,
      maxPriceCents: 9999,
      addedFrom: '2025-01-01',
      addedTo: '2025-12-31',
      tag: ['high-protein', 'vegetarian'],
      spec: ['texture:fine', 'source:plant'],
      availability: 'available',
      sort: 'oldest',
    }),
    true,
  );
  assert.equal(Value.Check(ProductQuery, { addedFrom: '2025-1-1' }), false);
  assert.equal(Value.Check(ProductQuery, { tag: ['Bad tag'] }), false);
  assert.equal(Value.Check(ProductQuery, { spec: ['texture=fine'] }), false);
  assert.equal(Value.Check(ProductQuery, { sort: 'popular' }), false);
  assert.equal(Value.Check(ProductQuery, { minPriceCents: -1 }), false);
  assert.equal(Value.Check(ProductQuery, { tag: Array.from({ length: 9 }, () => 'plant') }), false);
  assert.equal(
    Value.Check(ProductQuery, { spec: Array.from({ length: 9 }, () => 'texture:fine') }),
    false,
  );
});

void test('comparison transport preserves strict ordered mixed status items', () => {
  const response = {
    items: [
      { id: '3', status: 'available', product },
      { id: '2', status: 'inactive' },
      { id: '999', status: 'missing' },
    ],
  };
  assert.equal(Value.Check(ProductComparisonResponse, response), true);
  assert.equal(
    Value.Check(ProductComparisonResponse, {
      items: [
        { id: '1', status: 'available', product },
        { id: '2', status: 'inactive', product },
      ],
    }),
    false,
  );
  assert.equal(
    Value.Check(ProductComparisonResponse, {
      items: Array.from({ length: 5 }, (_, index) => ({
        id: String(index + 1),
        status: 'missing',
      })),
    }),
    false,
  );
  assert.equal(
    Value.Check(ProductComparisonResponse, { items: [{ id: '1', status: 'missing' }] }),
    false,
  );
  assert.equal(
    Value.Check(ProductComparisonResponse, {
      items: [
        { id: '1', status: 'missing', active: false },
        { id: '2', status: 'inactive' },
      ],
    }),
    false,
  );
});

void test('comparison query syntax is bounded and rejects malformed tokens', () => {
  assert.equal(Value.Check(ProductComparisonQuery, { ids: '3,1,9007199254740991' }), true);
  for (const ids of ['1, 2', '1,,2', '0,2', '+1,2', '-1,2', '1,a', '1,2,3,4,5']) {
    assert.equal(Value.Check(ProductComparisonQuery, { ids }), false, ids);
  }
  assert.equal(Value.Check(ProductComparisonQuery, { ids: '1,2', extra: true }), false);
});

void test('similar products transport accepts zero through five products only', () => {
  assert.equal(Value.Check(SimilarProductsResponse, []), true);
  assert.equal(
    Value.Check(
      SimilarProductsResponse,
      Array.from({ length: 5 }, () => product),
    ),
    true,
  );
  assert.equal(
    Value.Check(
      SimilarProductsResponse,
      Array.from({ length: 6 }, () => product),
    ),
    false,
  );
});
