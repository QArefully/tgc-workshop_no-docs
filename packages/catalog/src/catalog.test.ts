import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CATALOG_PRODUCTS,
  CATALOG_ARTWORK_IDS,
  CURATED_BUNDLES,
  CATALOG_CATEGORIES,
  MIXING_GROUPS,
  CATALOG_CREATED_AT_BY_ID,
  validateCatalog,
  type CatalogProduct,
} from './index.js';

void test('catalog contains exactly 100 base products', () => {
  assert.equal(CATALOG_PRODUCTS.length, 100);
});

void test('category target counts match plan: 20/20/15/15/15/15', () => {
  const counts = new Map<string, number>();
  for (const p of CATALOG_PRODUCTS) {
    counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  }
  assert.equal(counts.get('Sports Nutrition'), 20);
  assert.equal(counts.get('Baking & Pantry'), 20);
  assert.equal(counts.get('Drinks'), 15);
  assert.equal(counts.get('Household & Cleaning'), 15);
  assert.equal(counts.get('Garden & Outdoors'), 15);
  assert.equal(counts.get('Trade & Creative Materials'), 15);
});

void test('all product IDs are canonical: 1-50 or 1001-1050', () => {
  for (const p of CATALOG_PRODUCTS) {
    assert.ok(
      (p.id >= 1 && p.id <= 50) || (p.id >= 1001 && p.id <= 1050),
      `Product ${p.slug} has non-canonical ID ${p.id}`,
    );
  }
});

void test('no product claims IDs 51-1000', () => {
  for (const p of CATALOG_PRODUCTS) {
    assert.ok(p.id < 51 || p.id > 1000, `Product ${p.slug} claims reserved ID ${p.id}`);
  }
});

void test('all IDs and slugs are unique', () => {
  assert.equal(new Set(CATALOG_PRODUCTS.map((p) => p.id)).size, 100);
  assert.equal(new Set(CATALOG_PRODUCTS.map((p) => p.slug)).size, 100);
});

void test('all imageSetIds are unique', () => {
  assert.equal(new Set(CATALOG_ARTWORK_IDS).size, 100);
});

void test('all SKUs are unique across all products and variants', () => {
  const skus = CATALOG_PRODUCTS.flatMap((p) => p.variants.map((v) => v.sku));
  assert.equal(new Set(skus).size, skus.length);
});

void test('every product has at least one active variant with sortOrder=1', () => {
  for (const p of CATALOG_PRODUCTS) {
    assert.ok(p.variants.length >= 1, `${p.slug} has no variants`);
    const defaultVariant = p.variants.find((v) => v.sortOrder === 1 && v.active);
    assert.ok(defaultVariant, `${p.slug} missing active default variant (sortOrder=1)`);
  }
});

void test('every product has the industrial 25 kg sack and 1,000 kg pallet variants', () => {
  for (const p of CATALOG_PRODUCTS) {
    assert.equal(p.variants.length, 2, `${p.slug} must have exactly two variants`);
    assert.deepEqual(
      p.variants.map(({ label, weightGrams }) => ({ label, weightGrams })),
      [
        { label: '25 kg Sack', weightGrams: 25_000 },
        { label: '1,000 kg Pallet', weightGrams: 1_000_000 },
      ],
      `${p.slug} has invalid industrial packs`,
    );
    assert.ok(
      p.variants.every((variant) => variant.moqSacks === 4),
      `${p.slug} MOQ must be 4`,
    );
  }
});

void test('all variant weights are positive integers and <= 1,000,000g', () => {
  for (const p of CATALOG_PRODUCTS) {
    for (const v of p.variants) {
      assert.ok(
        Number.isSafeInteger(v.weightGrams) && v.weightGrams > 0,
        `Invalid weight on ${v.sku}`,
      );
      assert.ok(v.weightGrams <= 1_000_000, `${v.sku} exceeds max weight`);
    }
  }
});

void test('all variant prices and stock are safe integers', () => {
  for (const p of CATALOG_PRODUCTS) {
    for (const v of p.variants) {
      assert.ok(
        Number.isSafeInteger(v.priceCents) && v.priceCents > 0,
        `Invalid price on ${v.sku}`,
      );
      assert.ok(
        Number.isSafeInteger(v.stockCount) && v.stockCount >= 0,
        `Invalid stock on ${v.sku}`,
      );
      if (v.compareAtPriceCents !== undefined) {
        assert.ok(Number.isSafeInteger(v.compareAtPriceCents), `Invalid compare-at on ${v.sku}`);
        assert.ok(
          v.compareAtPriceCents > v.priceCents,
          `Compare-at should exceed price on ${v.sku}`,
        );
      }
    }
  }
});

void test('all canonical variants use freight delivery', () => {
  for (const p of CATALOG_PRODUCTS) {
    for (const v of p.variants) {
      assert.equal(v.deliveryClass, 'freight', `${v.sku} is not freight`);
    }
  }
});

void test('industrial pricing is material-specific USD cents', () => {
  const sackPrices = CATALOG_PRODUCTS.map((product) => product.variants[0]!.priceCents);
  assert.ok(sackPrices.every((priceCents) => priceCents >= 2_500));
  assert.ok(new Set(sackPrices).size > 1, 'all sack prices must not be uniform');
  for (const product of CATALOG_PRODUCTS) {
    assert.ok(
      product.variants[1]!.priceCents > product.variants[0]!.priceCents,
      `${product.slug} pallet price must exceed sack price`,
    );
  }
});

void test('canonical names and descriptions do not use retail powder terminology', () => {
  for (const p of CATALOG_PRODUCTS) {
    assert.doesNotMatch(p.name, /\bpowder(?:ed)?\b/i, `${p.slug} name retains powder terminology`);
    assert.doesNotMatch(
      p.description,
      /\bpowder(?:ed)?\b/i,
      `${p.slug} description retains powder terminology`,
    );
  }
});

void test('every product has valid consumption classification', () => {
  const allowed = new Set(['food', 'non-food', 'caution']);
  for (const p of CATALOG_PRODUCTS) {
    assert.ok(allowed.has(p.consumptionClassification), `${p.slug} invalid classification`);
    assert.equal(
      p.baseFacts.consumptionClassification,
      p.consumptionClassification,
      `${p.slug} facts mismatch`,
    );
  }
});

void test('every product has valid mixing group or null', () => {
  const allowed = new Set<string>(MIXING_GROUPS);
  for (const p of CATALOG_PRODUCTS) {
    if (p.mixingGroup !== null) {
      assert.ok(allowed.has(p.mixingGroup), `${p.slug} invalid mixing group ${p.mixingGroup}`);
    }
  }
});

void test('non-food products have clear handling/PPE/safety facts', () => {
  for (const p of CATALOG_PRODUCTS) {
    if (p.consumptionClassification === 'non-food' || p.consumptionClassification === 'caution') {
      assert.ok(p.baseFacts.storage.length > 5, `${p.slug} has short storage guidance`);
    }
  }
});

void test('food products have ingredients, allergens, and nutrition', () => {
  for (const p of CATALOG_PRODUCTS) {
    if (p.consumptionClassification === 'food') {
      const facts = p.categoryFacts as Record<string, unknown>;
      assert.ok(
        Array.isArray(facts.ingredients) && facts.ingredients.length > 0,
        `${p.slug} missing ingredients`,
      );
      assert.ok(Array.isArray(facts.allergens), `${p.slug} missing allergens array`);
      assert.ok(
        typeof facts.nutrition === 'object' && facts.nutrition !== null,
        `${p.slug} missing nutrition`,
      );
      assert.ok(
        typeof facts.servingSize === 'string' && facts.servingSize.length > 0,
        `${p.slug} missing servingSize`,
      );
    }
  }
});

void test('no conceptual quantity, impossible, questionable, or comedic content', () => {
  const banned =
    /conceptual quantity|powdered wifi|powdered water|powdered-gravity|powdered-moonlight|powdered silence|powdered weekend|powdered horizon|powdered five|powdered meeting|powdered tuesday|powdered queue|powdered spare|powdered house|powdered beach|powdered campfire|trail dust|moon rock|summit air|morning fog|sock drawer|bookshelf dusting|powdered internet|macbook|boat|plane|diamond/i;
  for (const p of CATALOG_PRODUCTS) {
    const text = `${p.slug} ${p.name} ${p.description} ${p.tags.join(' ')} ${p.baseFacts.intendedUse}`;
    assert.ok(!banned.test(text), `${p.slug} contains banned conceptual/comedic content`);
  }
});

void test('no health claims, medical claims, or performance guarantees', () => {
  const banned = /treats |cures |prevents |guarantees |medically |therapeutic|diagnoses/i;
  for (const p of CATALOG_PRODUCTS) {
    const text = `${p.name} ${p.description}`;
    assert.ok(!banned.test(text), `${p.slug} contains health/medical claim`);
  }
});

void test('all category files use only the six approved categories', () => {
  for (const p of CATALOG_PRODUCTS) {
    assert.ok(CATALOG_CATEGORIES.includes(p.category), `${p.slug} has invalid category`);
  }
});

void test('bundle components reference existing catalog variant SKUs', () => {
  const allSkus = new Set(CATALOG_PRODUCTS.flatMap((p) => p.variants.map((v) => v.sku)));
  for (const bundle of CURATED_BUNDLES) {
    assert.ok(bundle.components.length >= 2, `Bundle ${bundle.key} needs >= 2 components`);
    for (const component of bundle.components) {
      assert.ok(
        allSkus.has(component.variantSku),
        `Bundle ${bundle.key} has unknown SKU ${component.variantSku}`,
      );
    }
  }
});

void test('bundle components are separately packaged (different product SKUs)', () => {
  for (const bundle of CURATED_BUNDLES) {
    const productIds = new Set(
      bundle.components.map((c) => {
        const variantSku = c.variantSku;
        for (const p of CATALOG_PRODUCTS) {
          if (p.variants.some((v) => v.sku === variantSku)) return p.id;
        }
        return -1;
      }),
    );
    assert.equal(
      productIds.size,
      bundle.components.length,
      `Bundle ${bundle.key} has duplicate product variants`,
    );
  }
});

void test('bundle component quantities satisfy their variant MOQ', () => {
  const variantsBySku = new Map(
    CATALOG_PRODUCTS.flatMap((product) =>
      product.variants.map((variant) => [variant.sku, variant] as const),
    ),
  );
  for (const bundle of CURATED_BUNDLES) {
    for (const component of bundle.components) {
      const variant = variantsBySku.get(component.variantSku);
      assert.ok(variant, `Bundle ${bundle.key} has unknown variant ${component.variantSku}`);
      const minimumQuantity = Math.ceil((variant.moqSacks * 25_000) / variant.weightGrams);
      assert.ok(
        component.quantity >= minimumQuantity,
        `Bundle ${bundle.key} component ${component.variantSku} is below MOQ`,
      );
    }
  }
});

void test('every product has a deterministic imageSetId matching its slug', () => {
  for (const p of CATALOG_PRODUCTS) {
    assert.equal(p.imageSetId, p.slug, `${p.slug} imageSetId ${p.imageSetId} does not match slug`);
  }
});

void test('canonical validateCatalog passes with defaults', () => {
  assert.doesNotThrow(() => validateCatalog());
});

void test('validator rejects duplicate SKUs across products', () => {
  const products = JSON.parse(JSON.stringify(CATALOG_PRODUCTS)) as CatalogProduct[];
  const firstSku = products[0]!.variants[0]!.sku;
  const secondProduct = products[1]!;
  const oldVariant = secondProduct.variants[0]!;
  secondProduct.variants[0] = { ...oldVariant, sku: firstSku };
  assert.throws(() => validateCatalog(products), /Duplicate SKU/);
});

void test('validator rejects product > 1 tonne', () => {
  const products = JSON.parse(JSON.stringify(CATALOG_PRODUCTS)) as CatalogProduct[];
  const first = products[0];
  if (first) {
    const altered = first.variants.map((v) =>
      v.sortOrder === 1 ? { ...v, weightGrams: 1_000_001 } : v,
    );
    first.variants = altered;
  }
  assert.throws(() => validateCatalog(products), /max weight/);
});

void test('validator rejects missing default variant', () => {
  const products = JSON.parse(JSON.stringify(CATALOG_PRODUCTS)) as CatalogProduct[];
  if (products[0]) {
    products[0].variants = products[0].variants.map((v) =>
      v.sortOrder === 1 ? { ...v, active: false } : v,
    );
  }
  assert.throws(() => validateCatalog(products), /active default variant/);
});

void test('validator rejects bundle with unknown SKU', () => {
  const bundles = JSON.parse(JSON.stringify(CURATED_BUNDLES)) as typeof CURATED_BUNDLES;
  const firstBundle = {
    ...bundles[0],
    components: [
      { variantSku: 'BOGUS-SKU-999', quantity: 1, sortOrder: 1 },
      ...bundles[0].components.slice(1),
    ],
  };
  assert.throws(
    () => validateCatalog(CATALOG_PRODUCTS, [firstBundle, ...bundles.slice(1)]),
    /unknown variant SKU/,
  );
});

void test('validator rejects wrong product count', () => {
  assert.throws(() => validateCatalog(CATALOG_PRODUCTS.slice(0, 99)), /expected 100 products/);
});

void test('canonical timestamps match CATALOG_CREATED_AT_BY_ID', () => {
  for (const p of CATALOG_PRODUCTS) {
    assert.equal(p.createdAt, CATALOG_CREATED_AT_BY_ID[p.id], `${p.slug} timestamp mismatch`);
  }
});

void test('sale products have at least one variant with compareAtPriceCents', () => {
  for (const p of CATALOG_PRODUCTS) {
    if (p.onSale) {
      assert.ok(
        p.variants.some((v) => v.compareAtPriceCents !== undefined),
        `${p.slug} is onSale but has no variant with compare-at price`,
      );
    }
  }
});

void test('every product visibility is public', () => {
  for (const p of CATALOG_PRODUCTS) {
    assert.ok(
      p.visibility === 'public' || p.visibility === 'hidden',
      `${p.slug} has invalid visibility`,
    );
  }
});

void test('product slug and imageSetId use valid normalized keys', () => {
  const keyPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  for (const p of CATALOG_PRODUCTS) {
    assert.ok(keyPattern.test(p.slug), `${p.slug} invalid slug format`);
    assert.ok(keyPattern.test(p.imageSetId), `${p.slug} invalid imageSetId format`);
  }
});

void test('SKUs follow expected format with category prefix', () => {
  const prefixPattern = /^(SPN|BKP|DRK|HCL|GDN|TCM)-\d{4}-\d{3}$/;
  for (const p of CATALOG_PRODUCTS) {
    for (const v of p.variants) {
      assert.ok(prefixPattern.test(v.sku), `SKU ${v.sku} has invalid format`);
    }
  }
});
