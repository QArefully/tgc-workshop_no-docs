import assert from 'node:assert/strict';
import test from 'node:test';
import { Cart, CreateCartResponse } from '@shop/contracts/cart';
import { COUNTRY_PROFILES } from '@shop/contracts/country-profiles';
import { Value } from '@sinclair/typebox/value';
import { buildApp } from '../../src/app.js';
import { createSeededAppFixture } from '../support/seededDatabase.js';

interface Lot {
  id: number;
  product_id: number;
  moq_sacks: number;
  stock_count: number;
}

async function createCart(
  app: Awaited<ReturnType<typeof buildApp>>,
  country: 'CN' | 'UK' | 'US',
): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/cart', payload: { country } });
  assert.equal(response.statusCode, 201);
  return Value.Parse(CreateCartResponse, response.json()).cartId;
}

void test('cart writes enforce the persisted country without leaking lower-precedence facts', async (t) => {
  const fixture = await createSeededAppFixture(t);
  const { db, app } = fixture;

  const blockedLots = db
    .prepare(
      `SELECT pv.id, pv.product_id, pv.moq_sacks, pv.stock_count
       FROM product_variants pv
       INNER JOIN products p ON p.id = pv.product_id
       WHERE p.category = 'Sports Nutrition' AND p.active = 1 AND pv.active = 1
         AND pv.sort_order = 1 AND pv.weight_grams = 25000
       ORDER BY pv.id
       LIMIT 2`,
    )
    .all() as Lot[];
  assert.equal(blockedLots.length, 2);
  const [retiredBlocked, activeBlocked] = blockedLots as [Lot, Lot];

  const blendPair = db
    .prepare(
      `SELECT base.id, base.product_id, base.moq_sacks, base.stock_count,
              ingredient.id AS ingredient_id
       FROM product_variants base
       INNER JOIN products base_product ON base_product.id = base.product_id
       INNER JOIN products ingredient_product
         ON ingredient_product.mixing_group = base_product.mixing_group
       INNER JOIN product_variants ingredient ON ingredient.product_id = ingredient_product.id
       WHERE base_product.category != 'Sports Nutrition'
         AND ingredient_product.category = 'Sports Nutrition'
         AND base_product.active = 1 AND ingredient_product.active = 1
         AND base.active = 1 AND ingredient.active = 1
         AND base.sort_order = 1 AND ingredient.sort_order = 1
         AND base.weight_grams = 25000 AND ingredient.weight_grams = 25000
         AND base_product.mixing_group IS NOT NULL
         AND ingredient.id = ?
       ORDER BY base.id, ingredient.id
       LIMIT 1`,
    )
    .get(activeBlocked.id) as (Lot & { ingredient_id: number }) | undefined;
  assert.ok(blendPair, 'seed must expose an allowed base compatible with a blocked ingredient');

  db.prepare(
    'UPDATE product_variants SET active = 0, stock_count = 0, backorderable = 0 WHERE id = ?',
  ).run(retiredBlocked.id);
  db.prepare(
    'UPDATE product_variants SET stock_count = 1000, backorderable = 0 WHERE id IN (?, ?)',
  ).run(activeBlocked.id, blendPair.id);

  const bundleId = 9_200_001;
  db.prepare(
    `INSERT INTO curated_bundles (id, key, name, description, active, sort_order)
     VALUES (?, 'cart-country-blocking', 'Cart country blocking',
             'Persisted cart country regression fixture', 1, 999)`,
  ).run(bundleId);
  db.prepare(
    `INSERT INTO curated_bundle_components
      (bundle_id, variant_id, product_id, quantity, sort_order)
     VALUES (?, ?, ?, ?, 1), (?, ?, ?, ?, 2)`,
  ).run(
    bundleId,
    activeBlocked.id,
    activeBlocked.product_id,
    activeBlocked.moq_sacks,
    bundleId,
    blendPair.id,
    blendPair.product_id,
    blendPair.moq_sacks,
  );

  await t.test(
    'single add refuses a blocked retired lot despite a non-blocking header',
    async () => {
      const cartId = await createCart(app, 'CN');
      const movementCountBefore = db
        .prepare('SELECT COUNT(*) FROM inventory_stock_movements')
        .pluck()
        .get() as number;

      const response = await app.inject({
        method: 'POST',
        url: `/api/cart/${cartId}/items`,
        headers: { 'x-shop-country': 'US' },
        payload: {
          productId: String(retiredBlocked.product_id),
          variantId: retiredBlocked.id,
          quantity: 1,
        },
      });

      assert.equal(response.statusCode, 404);
      assert.equal(
        db.prepare('SELECT COUNT(*) FROM cart_line_items WHERE cart_id = ?').pluck().get(cartId),
        0,
      );
      assert.equal(
        db
          .prepare('SELECT stock_count FROM product_variants WHERE id = ?')
          .pluck()
          .get(retiredBlocked.id),
        0,
      );
      assert.equal(
        db.prepare('SELECT COUNT(*) FROM inventory_stock_movements').pluck().get(),
        movementCountBefore,
      );
    },
  );

  await t.test(
    'bulk add reports country blocking ahead of retirement, stock, and quantity',
    async () => {
      const cartId = await createCart(app, 'CN');
      const result = app.context.services.carts.addMany(
        cartId,
        [{ key: 'blocked', variantId: retiredBlocked.id, quantity: 0 }],
        { actor: { type: 'anonymous', userId: null }, requestId: 'country-bulk' },
      );

      assert.notEqual(typeof result, 'string');
      if (typeof result === 'string') return;
      assert.deepEqual(result.outcomes, [
        { key: 'blocked', status: 'skipped', reason: 'BLOCKED_IN_COUNTRY' },
      ]);
      assert.equal(result.cart.items.length, 0);
    },
  );

  await t.test(
    'a blocked blend ingredient produces the country-blocked outcome with resolved pricing',
    async () => {
      const usCartId = await createCart(app, 'US');
      const configured = await app.inject({
        method: 'POST',
        url: `/api/cart/${usCartId}/custom-blends`,
        headers: { 'x-shop-country': 'CN' },
        payload: {
          baseVariantId: blendPair.id,
          ingredients: [{ variantId: blendPair.ingredient_id, percentage: 5 }],
          quantity: blendPair.moq_sacks,
        },
      });
      assert.equal(configured.statusCode, 200, configured.body);
      const snapshot = Value.Parse(Cart, configured.json()).items[0]?.customBlend;
      assert.ok(snapshot);

      const cnCartId = await createCart(app, 'CN');
      const result = app.context.services.carts.addMany(
        cnCartId,
        [
          {
            key: 'blend',
            variantId: blendPair.id,
            quantity: blendPair.moq_sacks,
            customBlend: snapshot,
          },
        ],
        { actor: { type: 'anonymous', userId: null }, requestId: 'country-blend' },
      );
      assert.notEqual(typeof result, 'string');
      if (typeof result === 'string') return;
      assert.deepEqual(result.outcomes, [
        {
          key: 'blend',
          status: 'skipped',
          reason: 'BLOCKED_IN_COUNTRY',
          resolvedUnitPriceCents: 4260,
        },
      ]);
      assert.equal(result.cart.items.length, 0);
    },
  );

  await t.test('a non-blocking cart remains addable despite a blocking header', async () => {
    const cartId = await createCart(app, 'US');
    const response = await app.inject({
      method: 'POST',
      url: `/api/cart/${cartId}/items`,
      headers: { 'x-shop-country': 'CN' },
      payload: {
        productId: String(activeBlocked.product_id),
        variantId: activeBlocked.id,
        quantity: activeBlocked.moq_sacks,
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(
      Value.Parse(Cart, response.json()).items[0]?.variantSnap?.variantId,
      activeBlocked.id,
    );
  });

  await t.test(
    'bundle add refuses CN-blocked components without a header and with a spoofed US header',
    async () => {
      const noHeaderCartId = await createCart(app, 'CN');
      const spoofedHeaderCartId = await createCart(app, 'CN');
      const movementCountBefore = db
        .prepare('SELECT COUNT(*) FROM inventory_stock_movements')
        .pluck()
        .get() as number;
      const reservationCountBefore = db
        .prepare('SELECT COUNT(*) FROM inventory_reservations')
        .pluck()
        .get() as number;

      const noHeader = await app.inject({
        method: 'POST',
        url: `/api/cart/${noHeaderCartId}/bundles`,
        payload: { bundleId: String(bundleId) },
      });
      const spoofedHeader = await app.inject({
        method: 'POST',
        url: `/api/cart/${spoofedHeaderCartId}/bundles`,
        headers: { 'x-shop-country': 'US' },
        payload: { bundleId: String(bundleId) },
      });

      assert.deepEqual([noHeader.statusCode, spoofedHeader.statusCode], [409, 409]);
      for (const response of [noHeader, spoofedHeader]) {
        assert.deepEqual(response.json(), {
          code: 'BUNDLE_UNAVAILABLE',
          error: 'One or more bundle components are unavailable.',
        });
      }
      assert.equal(
        db
          .prepare('SELECT COUNT(*) FROM cart_line_items WHERE cart_id IN (?, ?)')
          .pluck()
          .get(noHeaderCartId, spoofedHeaderCartId),
        0,
      );
      assert.equal(
        db.prepare('SELECT COUNT(*) FROM inventory_stock_movements').pluck().get(),
        movementCountBefore,
      );
      assert.equal(
        db.prepare('SELECT COUNT(*) FROM inventory_reservations').pluck().get(),
        reservationCountBefore,
      );
    },
  );

  await t.test(
    'Quick Order accepts a US-blocked SKU when the persisted cart country is UK',
    async () => {
      const lot = db
        .prepare(
          `SELECT pv.sku, p.slug
           FROM product_variants pv
           INNER JOIN products p ON p.id = pv.product_id
           WHERE pv.id = ?`,
        )
        .get(activeBlocked.id) as { sku: string; slug: string };
      const usBlockedSlugs = COUNTRY_PROFILES.US.blockedProductSlugs as string[];
      const initialBlockedSlugCount = usBlockedSlugs.length;
      usBlockedSlugs.push(lot.slug);

      try {
        const cartId = await createCart(app, 'UK');
        const response = await app.inject({
          method: 'POST',
          url: `/api/cart/${cartId}/quick-order`,
          payload: { text: `${lot.sku}, ${activeBlocked.moq_sacks}` },
        });

        assert.equal(response.statusCode, 200, response.body);
        const body = response.json<{
          cart: { totalItems: number };
          outcomes: Array<{
            status: string;
            reason: string | null;
            variantId: number | null;
          }>;
        }>();
        assert.equal(body.cart.totalItems, activeBlocked.moq_sacks);
        assert.deepEqual(
          body.outcomes.map((outcome) => [outcome.status, outcome.reason, outcome.variantId]),
          [['added', null, activeBlocked.id]],
        );
      } finally {
        usBlockedSlugs.splice(initialBlockedSlugCount);
      }
    },
  );
});
