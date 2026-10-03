import assert from 'node:assert/strict';
import test from 'node:test';
import { COUNTRY_PROFILES } from '@shop/contracts/country-profiles';
import { createSeededAppFixture } from '../support/seededDatabase.js';
import { normalizeCatalogQuery } from '../../src/features/catalog/catalogQuery.js';
import { createProductRepository } from '../../src/features/catalog/productRepository.js';
import { buildCatalogPredicate } from '../../src/features/catalog/catalogSql.js';

const BLOCKED_PRODUCT_ID = 9_100_001;
const ALLOWED_PRODUCT_ID = 9_100_002;
const BLOCKED_SLUG = 'country-availability-blocked-lot';
const ALLOWED_SLUG = 'country-availability-allowed-lot';
const BLOCKED_TAG = 'country-blocked-only';
const TEST_BUNDLE_ID = 9_100_001;

function countryHeaders(country: 'CN' | 'US'): Record<string, string> {
  return { 'x-shop-country': country };
}

void test('catalog read paths enforce category and product country exclusions', async (t) => {
  const fixture = await createSeededAppFixture(t);
  const { db, app } = fixture;

  const seededCategoryProduct = db
    .prepare(
      `SELECT p.id, v.id AS variant_id
       FROM products p
       INNER JOIN product_variants v ON v.product_id = p.id
       WHERE p.category = 'Sports Nutrition' AND p.active = 1 AND v.active = 1
       ORDER BY p.id ASC, v.sort_order ASC
       LIMIT 1`,
    )
    .get() as { id: number; variant_id: number };

  const insertProduct = db.prepare(`
    INSERT INTO products
      (id, name, description, price_cents, category, stock_count, image_set_id, slug,
       compare_at_price_cents, sales_count, active, backorderable, backorder_lead_days,
       created_at, consumption_classification, mixing_group, details_json)
    VALUES (?, ?, ?, 2_000, 'Baking & Pantry', 100, ?, ?, NULL, ?, 1, 0, NULL,
            '2026-08-05T00:00:00.000Z', 'food', NULL, NULL)
  `);
  insertProduct.run(
    BLOCKED_PRODUCT_ID,
    'Country availability blocked lot',
    'Country availability blocked lot test fixture',
    BLOCKED_SLUG,
    BLOCKED_SLUG,
    999_999,
  );
  insertProduct.run(
    ALLOWED_PRODUCT_ID,
    'Country availability allowed lot',
    'Country availability allowed lot test fixture',
    ALLOWED_SLUG,
    ALLOWED_SLUG,
    999_998,
  );

  const insertVariant = db.prepare(`
    INSERT INTO product_variants
      (product_id, sku, label, weight_grams, price_cents, compare_at_price_cents,
       clearance_price_cents, clearance_starts_at, clearance_ends_at, stock_count,
       backorderable, backorder_lead_days, delivery_class, active, sort_order, moq_sacks,
       created_at, updated_at)
    VALUES (?, ?, ?, 25_000, 2_000, NULL, NULL, NULL, NULL, 100, 0, NULL, 'freight', 1, 1, 4,
            '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z')
  `);
  const blockedVariantId = Number(
    insertVariant.run(BLOCKED_PRODUCT_ID, 'COUNTRY-BLOCKED-SKU', 'Blocked sack').lastInsertRowid,
  );
  const allowedVariantId = Number(
    insertVariant.run(ALLOWED_PRODUCT_ID, 'COUNTRY-ALLOWED-SKU', 'Allowed sack').lastInsertRowid,
  );
  db.prepare('UPDATE products SET default_variant_id = ? WHERE id = ?').run(
    blockedVariantId,
    BLOCKED_PRODUCT_ID,
  );
  db.prepare('UPDATE products SET default_variant_id = ? WHERE id = ?').run(
    allowedVariantId,
    ALLOWED_PRODUCT_ID,
  );
  db.prepare('INSERT INTO catalog_tags (key, label) VALUES (?, ?)').run(
    BLOCKED_TAG,
    'Country blocked only',
  );
  db.prepare('INSERT INTO product_tags (product_id, tag_key) VALUES (?, ?)').run(
    BLOCKED_PRODUCT_ID,
    BLOCKED_TAG,
  );
  db.prepare(
    `INSERT INTO product_specifications
      (product_id, specification_key, value_key, display_value)
     VALUES (?, 'texture', 'country-blocked', 'Country blocked')`,
  ).run(BLOCKED_PRODUCT_ID);
  db.prepare(
    `INSERT INTO curated_bundles (id, key, name, description, active, sort_order)
     VALUES (?, 'country-availability-bundle', 'Country availability bundle',
             'Country availability bundle test fixture', 1, 999)`,
  ).run(TEST_BUNDLE_ID);
  db.prepare(
    `INSERT INTO curated_bundle_components
      (bundle_id, variant_id, product_id, quantity, sort_order)
     VALUES (?, ?, ?, 4, 1), (?, ?, ?, 4, 2)`,
  ).run(
    TEST_BUNDLE_ID,
    blockedVariantId,
    BLOCKED_PRODUCT_ID,
    TEST_BUNDLE_ID,
    allowedVariantId,
    ALLOWED_PRODUCT_ID,
  );
  const reviewAuthorId = db
    .prepare("SELECT id FROM users WHERE email = 'alice@example.com'")
    .pluck()
    .get() as number;
  db.prepare(
    `INSERT INTO reviews (product_id, user_id, rating, body, status)
     VALUES (?, ?, 5, 'Country availability blocked review fixture.', 'published')`,
  ).run(BLOCKED_PRODUCT_ID, reviewAuthorId);

  const cnBlockedSlugs = COUNTRY_PROFILES.CN.blockedProductSlugs as string[];
  const initialBlockedSlugCount = cnBlockedSlugs.length;
  cnBlockedSlugs.push(BLOCKED_SLUG);

  t.after(() => {
    cnBlockedSlugs.splice(initialBlockedSlugCount);
  });

  const cn = countryHeaders('CN');
  const us = countryHeaders('US');
  const productIds = `${BLOCKED_PRODUCT_ID},${seededCategoryProduct.id},${ALLOWED_PRODUCT_ID}`;

  await t.test('shared SQL uses bound exclusions and emits no empty-set clauses', () => {
    const empty = buildCatalogPredicate(normalizeCatalogQuery({}), '2026-08-05T12:00:00.000Z', {
      blockedCategories: [],
      blockedSlugs: [],
    });
    assert.deepEqual(empty, { where: 'WHERE p.active = 1', params: [] });

    const blocked = buildCatalogPredicate(normalizeCatalogQuery({}), '2026-08-05T12:00:00.000Z', {
      blockedCategories: ['Sports Nutrition'],
      blockedSlugs: [BLOCKED_SLUG],
    });
    assert.equal(
      blocked.where,
      'WHERE p.active = 1 AND p.category NOT IN (?) AND p.slug NOT IN (?)',
    );
    assert.deepEqual(blocked.params, ['Sports Nutrition', BLOCKED_SLUG]);
    assert.equal(blocked.where.includes(BLOCKED_SLUG), false);
  });

  await t.test(
    'repository direct product, variant ID, and SKU reads apply identical exclusions',
    () => {
      const repository = createProductRepository(db);
      const exclusions = {
        blockedCategories: ['Sports Nutrition'],
        blockedSlugs: [BLOCKED_SLUG],
      };
      assert.equal(repository.findById(BLOCKED_PRODUCT_ID, exclusions), undefined);
      assert.equal(repository.findById(seededCategoryProduct.id, exclusions), undefined);
      assert.deepEqual(
        repository
          .listByIds(
            [BLOCKED_PRODUCT_ID, seededCategoryProduct.id, ALLOWED_PRODUCT_ID],
            undefined,
            exclusions,
          )
          .map((product) => product.id),
        [ALLOWED_PRODUCT_ID],
      );
      assert.equal(repository.findVariantById(blockedVariantId, exclusions), undefined);
      assert.equal(
        repository.findVariantById(seededCategoryProduct.variant_id, exclusions),
        undefined,
      );
      assert.deepEqual(
        repository
          .findVariantsByIds(
            [blockedVariantId, seededCategoryProduct.variant_id, allowedVariantId],
            exclusions,
          )
          .map((variant) => variant.id),
        [allowedVariantId],
      );
      assert.deepEqual(
        repository
          .findVariantsBySkus(['COUNTRY-BLOCKED-SKU', 'COUNTRY-ALLOWED-SKU'], exclusions)
          .map((variant) => variant.sku),
        ['COUNTRY-ALLOWED-SKU'],
      );
    },
  );

  await t.test(
    'list, categories, filter options, and bestsellers differ only by availability',
    async () => {
      const cnList = await app.inject({
        method: 'GET',
        url: '/api/products?q=Country%20availability%20blocked%20lot&pageSize=48',
        headers: cn,
      });
      const usList = await app.inject({
        method: 'GET',
        url: '/api/products?q=Country%20availability%20blocked%20lot&pageSize=48',
        headers: us,
      });
      assert.equal(cnList.statusCode, 200);
      assert.equal(usList.statusCode, 200);
      assert.equal(cnList.json<{ total: number }>().total, 0);
      assert.equal(usList.json<{ total: number }>().total, 1);

      const cnCategoryList = await app.inject({
        method: 'GET',
        url: '/api/products?category=Sports%20Nutrition&pageSize=48',
        headers: cn,
      });
      const usCategoryList = await app.inject({
        method: 'GET',
        url: '/api/products?category=Sports%20Nutrition&pageSize=48',
        headers: us,
      });
      assert.equal(cnCategoryList.json<{ total: number }>().total, 0);
      assert.ok(usCategoryList.json<{ total: number }>().total > 0);

      const cnCategories = (
        await app.inject({ method: 'GET', url: '/api/products/categories', headers: cn })
      ).json<string[]>();
      const usCategories = (
        await app.inject({ method: 'GET', url: '/api/products/categories', headers: us })
      ).json<string[]>();
      assert.equal(cnCategories.includes('Sports Nutrition'), false);
      assert.equal(usCategories.includes('Sports Nutrition'), true);

      const cnOptions = (
        await app.inject({ method: 'GET', url: '/api/products/filter-options', headers: cn })
      ).json<{ tags: Array<{ key: string }> }>();
      const usOptions = (
        await app.inject({ method: 'GET', url: '/api/products/filter-options', headers: us })
      ).json<{ tags: Array<{ key: string }> }>();
      assert.equal(
        cnOptions.tags.some((tag) => tag.key === BLOCKED_TAG),
        false,
      );
      assert.equal(
        usOptions.tags.some((tag) => tag.key === BLOCKED_TAG),
        true,
      );

      const cnBestsellers = (
        await app.inject({ method: 'GET', url: '/api/products/bestsellers', headers: cn })
      ).json<Array<{ id: string }>>();
      const usBestsellers = (
        await app.inject({ method: 'GET', url: '/api/products/bestsellers', headers: us })
      ).json<Array<{ id: string }>>();
      assert.equal(
        cnBestsellers.some((product) => product.id === String(BLOCKED_PRODUCT_ID)),
        false,
      );
      assert.equal(
        usBestsellers.some((product) => product.id === String(BLOCKED_PRODUCT_ID)),
        true,
      );
    },
  );

  await t.test(
    'comparison reports both exclusion types exactly like missing products',
    async () => {
      const cnResponse = await app.inject({
        method: 'GET',
        url: `/api/products/compare?ids=${productIds}`,
        headers: cn,
      });
      const usResponse = await app.inject({
        method: 'GET',
        url: `/api/products/compare?ids=${productIds}`,
        headers: us,
      });
      assert.deepEqual(
        cnResponse
          .json<{ items: Array<{ id: string; status: string }> }>()
          .items.map((item) => [item.id, item.status]),
        [
          [String(BLOCKED_PRODUCT_ID), 'missing'],
          [String(seededCategoryProduct.id), 'missing'],
          [String(ALLOWED_PRODUCT_ID), 'available'],
        ],
      );
      assert.deepEqual(
        usResponse
          .json<{ items: Array<{ id: string; status: string }> }>()
          .items.map((item) => [item.id, item.status]),
        [
          [String(BLOCKED_PRODUCT_ID), 'available'],
          [String(seededCategoryProduct.id), 'available'],
          [String(ALLOWED_PRODUCT_ID), 'available'],
        ],
      );
    },
  );

  await t.test('detail, similar, and related use the existing not-found boundary', async () => {
    const missing = await app.inject({
      method: 'GET',
      url: '/api/products/919999999',
      headers: cn,
    });
    for (const productId of [BLOCKED_PRODUCT_ID, seededCategoryProduct.id]) {
      const cnDetail = await app.inject({
        method: 'GET',
        url: `/api/products/${productId}`,
        headers: cn,
      });
      const usDetail = await app.inject({
        method: 'GET',
        url: `/api/products/${productId}`,
        headers: us,
      });
      assert.equal(cnDetail.statusCode, 404);
      assert.equal(cnDetail.body, missing.body);
      assert.equal(usDetail.statusCode, 200);

      for (const suffix of ['similar', 'related']) {
        const cnRelated = await app.inject({
          method: 'GET',
          url: `/api/products/${productId}/${suffix}`,
          headers: cn,
        });
        const usRelated = await app.inject({
          method: 'GET',
          url: `/api/products/${productId}/${suffix}`,
          headers: us,
        });
        assert.equal(cnRelated.statusCode, 404);
        assert.equal(cnRelated.body, missing.body);
        assert.equal(usRelated.statusCode, 200);
      }
    }
  });

  await t.test('quick order distinguishes a blocked SKU without making it addable', async () => {
    const cnCartResponse = await app.inject({
      method: 'POST',
      url: '/api/cart',
      headers: cn,
      payload: { country: 'CN' },
    });
    assert.equal(cnCartResponse.statusCode, 201);
    const cnCartId = cnCartResponse.json<{ cartId: string }>().cartId;
    const cnQuickOrder = await app.inject({
      method: 'POST',
      url: `/api/cart/${cnCartId}/quick-order`,
      headers: cn,
      payload: { text: 'COUNTRY-BLOCKED-SKU, 4\nCOUNTRY-UNKNOWN-SKU, 4' },
    });
    assert.equal(cnQuickOrder.statusCode, 200);
    const cnBody = cnQuickOrder.json<{
      cart: { totalItems: number };
      outcomes: Array<{
        reason: string | null;
        variantId: number | null;
        productId: string | null;
        productName: string | null;
      }>;
    }>();
    assert.equal(cnBody.cart.totalItems, 0);
    assert.deepEqual(
      cnBody.outcomes.map((outcome) => outcome.reason),
      ['BLOCKED_IN_COUNTRY', 'SKU_NOT_FOUND'],
    );
    const blockedOutcome = cnBody.outcomes[0]!;
    assert.equal(blockedOutcome.variantId, null);
    assert.equal(blockedOutcome.productId, null);
    assert.equal(blockedOutcome.productName, null);

    const usCartResponse = await app.inject({
      method: 'POST',
      url: '/api/cart',
      headers: us,
      payload: { country: 'US' },
    });
    assert.equal(usCartResponse.statusCode, 201);
    const usCartId = usCartResponse.json<{ cartId: string }>().cartId;
    const usQuickOrder = await app.inject({
      method: 'POST',
      url: `/api/cart/${usCartId}/quick-order`,
      headers: us,
      payload: { text: 'COUNTRY-BLOCKED-SKU, 4' },
    });
    assert.equal(usQuickOrder.statusCode, 200);
    const usBody = usQuickOrder.json<{
      cart: { totalItems: number };
      outcomes: Array<{ status: string; reason: string | null; productName: string | null }>;
    }>();
    assert.equal(usBody.cart.totalItems, 4);
    assert.equal(usBody.outcomes.length, 1);
    assert.equal(usBody.outcomes[0]?.status, 'added');
    assert.equal(usBody.outcomes[0]?.reason, null);
    assert.equal(usBody.outcomes[0]?.productName, 'Country availability blocked lot');
  });

  await t.test(
    'cart product resolution hides a blocked product like a missing product',
    async () => {
      const cnCartResponse = await app.inject({
        method: 'POST',
        url: '/api/cart',
        headers: cn,
        payload: { country: 'CN' },
      });
      const missingCartResponse = await app.inject({
        method: 'POST',
        url: '/api/cart',
        headers: cn,
        payload: { country: 'CN' },
      });
      const usCartResponse = await app.inject({
        method: 'POST',
        url: '/api/cart',
        headers: us,
        payload: { country: 'US' },
      });
      assert.equal(cnCartResponse.statusCode, 201);
      assert.equal(missingCartResponse.statusCode, 201);
      assert.equal(usCartResponse.statusCode, 201);

      const cnAdd = await app.inject({
        method: 'POST',
        url: `/api/cart/${cnCartResponse.json<{ cartId: string }>().cartId}/items`,
        headers: cn,
        payload: { productId: String(BLOCKED_PRODUCT_ID), quantity: 4 },
      });
      const missingAdd = await app.inject({
        method: 'POST',
        url: `/api/cart/${missingCartResponse.json<{ cartId: string }>().cartId}/items`,
        headers: cn,
        payload: { productId: '919999999', quantity: 4 },
      });
      assert.equal(cnAdd.statusCode, 400);
      assert.equal(missingAdd.statusCode, 400);
      assert.equal(cnAdd.json<{ code: string }>().code, 'VARIANT_NOT_FOUND');
      assert.equal(missingAdd.json<{ code: string }>().code, 'VARIANT_NOT_FOUND');

      const usAdd = await app.inject({
        method: 'POST',
        url: `/api/cart/${usCartResponse.json<{ cartId: string }>().cartId}/items`,
        headers: us,
        payload: { productId: String(BLOCKED_PRODUCT_ID), quantity: 4 },
      });
      assert.equal(usAdd.statusCode, 200);
      assert.equal(
        usAdd.json<{ items: Array<{ variantSnap?: { variantId: number } }> }>().items[0]
          ?.variantSnap?.variantId,
        blockedVariantId,
      );
    },
  );

  await t.test(
    'product reviews hide a blocked product behind the existing 404 boundary',
    async () => {
      const cnReviews = await app.inject({
        method: 'GET',
        url: `/api/products/${BLOCKED_PRODUCT_ID}/reviews`,
        headers: cn,
      });
      const missingReviews = await app.inject({
        method: 'GET',
        url: '/api/products/919999999/reviews',
        headers: cn,
      });
      const usReviews = await app.inject({
        method: 'GET',
        url: `/api/products/${BLOCKED_PRODUCT_ID}/reviews`,
        headers: us,
      });
      assert.equal(cnReviews.statusCode, 404);
      assert.equal(cnReviews.body, missingReviews.body);
      assert.equal(usReviews.statusCode, 200);
      assert.equal(usReviews.json<{ items: unknown[] }>().items.length, 1);
    },
  );

  await t.test(
    'bundles hide blocked components and reuse the existing add unavailability path',
    async () => {
      const cnList = await app.inject({
        method: 'GET',
        url: `/api/bundles?productId=${BLOCKED_PRODUCT_ID}`,
        headers: cn,
      });
      const missingList = await app.inject({
        method: 'GET',
        url: '/api/bundles?productId=919999999',
        headers: cn,
      });
      const usList = await app.inject({
        method: 'GET',
        url: `/api/bundles?productId=${BLOCKED_PRODUCT_ID}`,
        headers: us,
      });
      assert.equal(cnList.body, missingList.body);
      assert.deepEqual(cnList.json(), []);
      assert.equal(
        usList.json<Array<{ id: string }>>().some((bundle) => bundle.id === String(TEST_BUNDLE_ID)),
        true,
      );

      const cnCart = (
        await app.inject({
          method: 'POST',
          url: '/api/cart',
          headers: cn,
          payload: { country: 'CN' },
        })
      ).json<{ cartId: string }>();
      const cnAdd = await app.inject({
        method: 'POST',
        url: `/api/cart/${cnCart.cartId}/bundles`,
        headers: cn,
        payload: { bundleId: String(TEST_BUNDLE_ID) },
      });
      assert.equal(cnAdd.statusCode, 409);
      const cnBundleBody = cnAdd.json<{
        error: string;
        code: string;
        meta?: { variantIds?: string[] };
      }>();
      assert.deepEqual(cnBundleBody, {
        error: '请求无法处理，请重试。',
        code: 'BUNDLE_UNAVAILABLE',
      });

      const usCart = (
        await app.inject({
          method: 'POST',
          url: '/api/cart',
          headers: us,
          payload: { country: 'US' },
        })
      ).json<{ cartId: string }>();
      const usAdd = await app.inject({
        method: 'POST',
        url: `/api/cart/${usCart.cartId}/bundles`,
        headers: us,
        payload: { bundleId: String(TEST_BUNDLE_ID) },
      });
      assert.equal(usAdd.statusCode, 200);
    },
  );
});
