import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../../src/app.js';
import { createSeededAppFixture } from '../support/seededDatabase.js';

const NOW = new Date('2026-08-05T10:00:00.000Z');
const CN_HEADERS = { 'x-shop-country': 'CN' };
const UK_HEADERS = { 'x-shop-country': 'UK' };
const US_HEADERS = { 'x-shop-country': 'US' };

type App = Awaited<ReturnType<typeof buildApp>>;

async function createCart(app: App, country: 'CN' | 'UK' | 'US'): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/cart',
    headers: { 'x-shop-country': country },
    payload: { country },
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<{ cartId: string }>().cartId;
}

async function firstSlot(app: App, cartId: string): Promise<{ date: string; window: 'am' | 'pm' }> {
  const response = await app.inject({
    method: 'GET',
    url: `/api/delivery/slots?cartId=${cartId}`,
  });
  assert.equal(response.statusCode, 200, response.body);
  const slots = response.json<{ slots: Array<{ date: string; window: 'am' | 'pm' }> }>().slots;
  assert.ok(slots.length > 0, 'seeded cart must expose a delivery slot');
  return slots[0]!;
}

function paymentPayload(
  cartId: string,
  deliveryCountryCode: 'CN' | 'FR',
  postcode: string,
  deliverySlot: { date: string; window: 'am' | 'pm' },
  idempotencyKey: string,
) {
  return {
    cartId,
    customerName: 'Country Stage 2 Buyer',
    customerEmail: 'country-stage2@example.test',
    deliveryDestination: {
      kind: 'adhoc' as const,
      address: {
        line1: '1 Country Stage Way',
        city: deliveryCountryCode === 'CN' ? 'Shanghai' : 'Paris',
        postcode,
        countryCode: deliveryCountryCode,
      },
    },
    billingSelection: {
      kind: 'adhoc' as const,
      billingEntity: {
        legalName: 'Country Stage 2 Buyer Ltd',
        address: {
          line1: '1 Billing Way',
          city: 'London',
          postcode: 'EC2A 2BB',
          countryCode: 'GB' as const,
        },
      },
    },
    deliverySlot,
    cardNumber: '4242 4242 4242 4242',
    cardExpiry: '12/99',
    cardCvc: '123',
    idempotencyKey,
  };
}

void test('country stage 2 composes availability, checkout, delivery, and promo rules', async (t) => {
  const fixture = await createSeededAppFixture({
    testContext: t,
    app: { clock: { now: () => NOW } },
  });
  const { db, app } = fixture;

  const blockedLot = db
    .prepare(
      `SELECT p.id AS product_id, v.id AS variant_id, v.moq_sacks
       FROM products AS p
       INNER JOIN product_variants AS v ON v.product_id = p.id
       WHERE p.category = 'Sports Nutrition' AND p.active = 1
         AND v.active = 1 AND v.sort_order = 1
       ORDER BY p.id, v.id
       LIMIT 1`,
    )
    .get() as { product_id: number; variant_id: number; moq_sacks: number } | undefined;
  assert.ok(blockedLot, 'seed must provide an active Sports Nutrition lot');
  db.prepare('UPDATE product_variants SET stock_count = 1000 WHERE id = ?').run(
    blockedLot.variant_id,
  );

  await t.test('CN cannot browse or open the seeded blocked category, while UK can', async () => {
    const cnBrowse = await app.inject({
      method: 'GET',
      url: '/api/products?category=Sports%20Nutrition&pageSize=48',
      headers: CN_HEADERS,
    });
    const ukBrowse = await app.inject({
      method: 'GET',
      url: '/api/products?category=Sports%20Nutrition&pageSize=48',
      headers: UK_HEADERS,
    });
    assert.equal(cnBrowse.statusCode, 200, cnBrowse.body);
    assert.equal(ukBrowse.statusCode, 200, ukBrowse.body);
    assert.equal(cnBrowse.json<{ total: number }>().total, 0);
    assert.ok(ukBrowse.json<{ total: number }>().total > 0);

    const cnOpen = await app.inject({
      method: 'GET',
      url: `/api/products/${blockedLot.product_id}`,
      headers: CN_HEADERS,
    });
    const missingOpen = await app.inject({
      method: 'GET',
      url: '/api/products/999999999',
      headers: CN_HEADERS,
    });
    const ukOpen = await app.inject({
      method: 'GET',
      url: `/api/products/${blockedLot.product_id}`,
      headers: UK_HEADERS,
    });
    assert.equal(cnOpen.statusCode, 404);
    assert.equal(cnOpen.body, missingOpen.body);
    assert.equal(ukOpen.statusCode, 200, ukOpen.body);
  });

  await t.test('CN cannot add or check out the blocked lot, while UK can add it', async () => {
    const cnCart = await createCart(app, 'CN');
    const cnAdd = await app.inject({
      method: 'POST',
      url: `/api/cart/${cnCart}/items`,
      headers: CN_HEADERS,
      payload: {
        productId: String(blockedLot.product_id),
        variantId: blockedLot.variant_id,
        quantity: blockedLot.moq_sacks,
      },
    });
    const unknownAdd = await app.inject({
      method: 'POST',
      url: `/api/cart/${cnCart}/items`,
      headers: CN_HEADERS,
      payload: { productId: '999999999', variantId: 999999999, quantity: blockedLot.moq_sacks },
    });
    assert.equal(cnAdd.statusCode, 404);
    assert.equal(cnAdd.body, unknownAdd.body);

    const ukCart = await createCart(app, 'UK');
    const ukAdd = await app.inject({
      method: 'POST',
      url: `/api/cart/${ukCart}/items`,
      headers: US_HEADERS,
      payload: {
        productId: String(blockedLot.product_id),
        variantId: blockedLot.variant_id,
        quantity: blockedLot.moq_sacks,
      },
    });
    assert.equal(ukAdd.statusCode, 200, ukAdd.body);

    const checkoutCart = await createCart(app, 'US');
    const checkoutAdd = await app.inject({
      method: 'POST',
      url: `/api/cart/${checkoutCart}/items`,
      headers: US_HEADERS,
      payload: {
        productId: String(blockedLot.product_id),
        variantId: blockedLot.variant_id,
        quantity: blockedLot.moq_sacks,
      },
    });
    assert.equal(checkoutAdd.statusCode, 200, checkoutAdd.body);
    db.prepare("UPDATE carts SET country = 'CN' WHERE id = ?").run(checkoutCart);
    const blockedPayment = await app.inject({
      method: 'POST',
      url: '/api/payments/pay',
      headers: US_HEADERS,
      payload: paymentPayload(
        checkoutCart,
        'CN',
        '100000',
        await firstSlot(app, checkoutCart),
        'ad9a90e4-a5c6-4cc6-ae85-0dd63df47718',
      ),
    });
    assert.equal(blockedPayment.statusCode, 409, blockedPayment.body);
    assert.deepEqual(blockedPayment.json(), {
      error: 'This item is not available in your country.',
      code: 'BLOCKED_IN_COUNTRY',
      meta: { productIds: [String(blockedLot.product_id)] },
    });
  });

  await t.test(
    'delivery refuses a cross-border destination and promo targeting follows cart country',
    async () => {
      const ukCart = await createCart(app, 'UK');
      const ukAdd = await app.inject({
        method: 'POST',
        url: `/api/cart/${ukCart}/items`,
        headers: UK_HEADERS,
        payload: {
          productId: String(blockedLot.product_id),
          variantId: blockedLot.variant_id,
          quantity: blockedLot.moq_sacks,
        },
      });
      assert.equal(ukAdd.statusCode, 200, ukAdd.body);
      const crossBorderPayment = await app.inject({
        method: 'POST',
        url: '/api/payments/pay',
        payload: paymentPayload(
          ukCart,
          'FR',
          '75001',
          await firstSlot(app, ukCart),
          '524b2f10-2a8d-4a47-884e-0d83e44f3c10',
        ),
      });
      assert.equal(crossBorderPayment.statusCode, 400, crossBorderPayment.body);
      assert.deepEqual(crossBorderPayment.json(), {
        error: 'Delivery is only available within your country.',
        code: 'DELIVERY_COUNTRY_NOT_ALLOWED',
      });

      const ukPromoCart = await createCart(app, 'UK');
      const usPromoCart = await createCart(app, 'US');
      const ukPromo = await app.inject({
        method: 'POST',
        url: '/api/promo/validate',
        payload: { cartId: ukPromoCart, promoCode: 'LOC-UK-DE-10' },
      });
      const usPromo = await app.inject({
        method: 'POST',
        url: '/api/promo/validate',
        payload: { cartId: usPromoCart, promoCode: 'LOC-UK-DE-10' },
      });
      const unknownPromo = await app.inject({
        method: 'POST',
        url: '/api/promo/validate',
        payload: { cartId: usPromoCart, promoCode: 'NO-SUCH-COUNTRY-PROMO' },
      });
      assert.equal(ukPromo.statusCode, 200, ukPromo.body);
      assert.equal(ukPromo.json<{ valid: boolean }>().valid, true);
      assert.equal(usPromo.statusCode, 200, usPromo.body);
      assert.equal(usPromo.body, unknownPromo.body);
      assert.deepEqual(usPromo.json(), {
        valid: false,
        errorCode: 'INVALID',
      });
    },
  );
});
