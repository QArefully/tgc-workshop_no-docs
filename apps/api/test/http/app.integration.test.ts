import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../../src/app.js';
import { openDatabase } from '../../src/db/index.js';
import { adhocBilling, adhocDestination, bookableSlot } from '../checkout/checkoutDepthFixtures.js';
import { createSeededAppFixture, openSeededDatabase } from '../support/seededDatabase.js';

function firstActiveVariantId(db: ReturnType<typeof openDatabase>, productId: number): number {
  const row = db
    .prepare(
      'SELECT id FROM product_variants WHERE product_id = ? AND active = 1 ORDER BY sort_order LIMIT 1',
    )
    .get(productId) as { id: number } | undefined;
  if (!row) throw new Error(`Expected an active variant for product ${productId}`);
  return row.id;
}

function cookieHeader(response: {
  headers: Record<string, string | string[] | undefined>;
}): string {
  const value = response.headers['set-cookie'];
  const cookie = Array.isArray(value) ? value[0] : value;
  if (!cookie) throw new Error('Expected session cookie');
  return cookie.split(';', 1)[0]!;
}

void test('app factory injects isolated databases without starting a server', async (t) => {
  const firstFixture = openSeededDatabase();
  const secondFixture = openSeededDatabase();
  const firstDb = firstFixture.db;
  const secondDb = secondFixture.db;

  const app = await buildApp({ db: firstDb, resetBaseUrl: 'http://web.test' });
  t.after(async () => {
    await app.close();
    await firstFixture.cleanup();
    await secondFixture.cleanup();
  });

  const health = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), { status: 'ok' });

  const product = await app.inject({ method: 'GET', url: '/api/products/1' });
  assert.equal(product.statusCode, 200);
  const productBody: unknown = product.json();
  if (typeof productBody !== 'object' || productBody === null || !('id' in productBody)) {
    assert.fail('Product response must contain an ID');
  }
  assert.equal(productBody.id, '1');
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/products/categories' })).statusCode,
    200,
  );
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/products/not-a-number' })).statusCode,
    400,
  );

  const invalidCart = await app.inject({
    method: 'POST',
    url: '/api/cart/not-a-cart/items',
    payload: {},
  });
  assert.equal(invalidCart.statusCode, 400, 'route schema validation uses global error mapping');
  const created = await app.inject({ method: 'POST', url: '/api/cart' });
  assert.equal(created.statusCode, 201);
  const createdBody: { cartId: string } = created.json();
  const added = await app.inject({
    method: 'POST',
    url: `/api/cart/${createdBody.cartId}/items`,
    payload: { productId: '1', variantId: firstActiveVariantId(firstDb, 1) },
  });
  assert.equal(added.statusCode, 200);
  const addedBody: { totalItems: number } = added.json();
  assert.ok(addedBody.totalItems >= 1);
  assert.equal((await app.inject({ method: 'GET', url: '/api/saved-lists' })).statusCode, 401);

  const signup = await app.inject({
    method: 'POST',
    url: '/signup',
    payload: {
      email: 'http@example.test',
      password: 'password-one',
      displayName: 'HTTP User',
      country: 'UK',
    },
  });
  assert.equal(signup.statusCode, 201);
  const cookie = cookieHeader(signup);
  const authenticated = await app.inject({ method: 'GET', url: '/me', headers: { cookie } });
  assert.equal(authenticated.statusCode, 200);
  const authenticatedBody: { email: string } = authenticated.json();
  assert.equal(authenticatedBody.email, 'http@example.test');
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/saved-lists', headers: { cookie } })).statusCode,
    200,
  );

  const checkoutCart = await app.inject({ method: 'POST', url: '/api/cart' });
  const checkoutCartBody: { cartId: string } = checkoutCart.json();
  const checkoutCartId = checkoutCartBody.cartId;
  for (const productId of ['1', '2', '3', '4', '5']) {
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/api/cart/${checkoutCartId}/items`,
          payload: { productId, variantId: firstActiveVariantId(firstDb, Number(productId)) },
        })
      ).statusCode,
      200,
    );
  }
  const freightCart = await app.inject({ method: 'GET', url: `/api/cart/${checkoutCartId}` });
  assert.equal(freightCart.statusCode, 200);
  const freightCartBody: {
    subtotalCents: number;
    deliveryPreview?: { chargeCents: number; mode: string };
  } = freightCart.json();
  assert.equal(freightCartBody.deliveryPreview?.mode, 'freight');
  assert.equal(freightCartBody.deliveryPreview?.chargeCents, 999);

  const promo = await app.inject({
    method: 'POST',
    url: '/api/promo/validate',
    headers: { cookie },
    payload: { cartId: checkoutCartId, promoCode: 'SAVE10' },
  });
  assert.equal(promo.statusCode, 200);
  const promoBody: {
    valid: boolean;
    promoCode?: { code: string };
    discountBaseCents?: number;
    discountCents?: number;
    totalCents?: number;
  } = promo.json();
  assert.deepEqual(promoBody.promoCode, {
    code: 'SAVE10',
    discountPercent: 10,
    minItemCount: 5,
    kind: 'percent',
  });
  assert.equal(promoBody.discountBaseCents, freightCartBody.subtotalCents);
  assert.equal(promoBody.discountCents, Math.floor(freightCartBody.subtotalCents * 0.1));
  assert.equal(
    promoBody.totalCents,
    freightCartBody.subtotalCents -
      promoBody.discountCents +
      freightCartBody.deliveryPreview.chargeCents,
  );

  const payment = await app.inject({
    method: 'POST',
    url: '/api/payments/pay',
    headers: { cookie },
    payload: {
      cartId: checkoutCartId,
      promoCode: 'SAVE10',
      customerName: 'HTTP User',
      customerEmail: 'http@example.test',
      deliveryDestination: adhocDestination,
      billingSelection: adhocBilling,
      deliverySlot: bookableSlot(),
      cardNumber: '4242 4242 4242 4242',
      cardExpiry: '12/99',
      cardCvc: '123',
      idempotencyKey: '10f4fa81-4d9e-4b6c-b2ee-575c0b07b640',
    },
  });
  assert.equal(payment.statusCode, 201);
  const order: { id: string; promoApplied: string | null; items: unknown[] } = payment.json();
  assert.equal(order.promoApplied, 'SAVE10');
  assert.equal(order.items.length, 5);
  assert.equal(
    (await app.inject({ method: 'GET', url: `/api/orders/${order.id}`, headers: { cookie } }))
      .statusCode,
    200,
  );

  const declineCart = await app.inject({ method: 'POST', url: '/api/cart' });
  const declineCartBody: { cartId: string } = declineCart.json();
  const declineCartId = declineCartBody.cartId;
  await app.inject({
    method: 'POST',
    url: `/api/cart/${declineCartId}/items`,
    payload: { productId: '1', variantId: firstActiveVariantId(firstDb, 1) },
  });
  const declined = await app.inject({
    method: 'POST',
    url: '/api/payments/pay',
    payload: {
      cartId: declineCartId,
      customerName: 'Declined User',
      customerEmail: 'declined@example.test',
      deliveryDestination: adhocDestination,
      billingSelection: adhocBilling,
      deliverySlot: bookableSlot(),
      cardNumber: '4000 0000 0000 0002',
      cardExpiry: '12/99',
      cardCvc: '123',
      idempotencyKey: '32760c6e-4b82-44d4-8e06-6bdfbf9adcf7',
    },
  });
  assert.equal(declined.statusCode, 402);
  assert.deepEqual(declined.json(), { error: 'The card was declined.', code: 'CARD_DECLINED' });
  assert.equal((await app.inject({ method: 'GET', url: '/missing' })).statusCode, 404);
  assert.equal(firstDb.open, true);
  assert.equal(secondDb.open, true);
});

void test('promo validation exposes a scoped discount base without discounting other categories', async (t) => {
  const fixture = await createSeededAppFixture(t);
  const { db, app } = fixture;

  const cartResponse = await app.inject({ method: 'POST', url: '/api/cart' });
  const { cartId } = cartResponse.json<{ cartId: string }>();
  for (const productId of [27, 1]) {
    const added = await app.inject({
      method: 'POST',
      url: `/api/cart/${cartId}/items`,
      payload: { productId: String(productId), variantId: firstActiveVariantId(db, productId) },
    });
    assert.equal(added.statusCode, 200);
  }
  const cart = (await app.inject({ method: 'GET', url: `/api/cart/${cartId}` })).json<{
    subtotalCents: number;
    discountableSubtotalCents: number;
    deliveryPreview?: { chargeCents: number };
    items: Array<{ product: { category: string }; discountableTotalCents: number }>;
  }>();
  const gardenBaseCents = cart.items
    .filter((item) => item.product.category === 'Garden & Outdoors')
    .reduce((total, item) => total + item.discountableTotalCents, 0);
  assert.ok(gardenBaseCents > 0);
  assert.ok(gardenBaseCents < cart.discountableSubtotalCents);

  const scoped = await app.inject({
    method: 'POST',
    url: '/api/promo/validate',
    payload: { cartId, promoCode: 'GARDEN10' },
  });
  assert.equal(scoped.statusCode, 200);
  const scopedBody = scoped.json<{
    valid: boolean;
    discountBaseCents: number;
    discountCents: number;
    totalCents: number;
  }>();
  assert.equal(scopedBody.valid, true);
  assert.equal(scopedBody.discountBaseCents, gardenBaseCents);
  assert.equal(scopedBody.discountCents, Math.floor(gardenBaseCents * 0.1));
  assert.equal(
    scopedBody.totalCents,
    cart.subtotalCents - scopedBody.discountCents + (cart.deliveryPreview?.chargeCents ?? 0),
  );

  const mismatchCart = await app.inject({ method: 'POST', url: '/api/cart' });
  const { cartId: mismatchCartId } = mismatchCart.json<{ cartId: string }>();
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: `/api/cart/${mismatchCartId}/items`,
        payload: { productId: '1', variantId: firstActiveVariantId(db, 1) },
      })
    ).statusCode,
    200,
  );
  const mismatch = await app.inject({
    method: 'POST',
    url: '/api/promo/validate',
    payload: { cartId: mismatchCartId, promoCode: 'GARDEN10' },
  });
  assert.equal(mismatch.statusCode, 200);
  assert.deepEqual(mismatch.json(), {
    valid: false,
    errorCode: 'CATEGORY_MISMATCH',
  });

  const missingCart = await app.inject({
    method: 'POST',
    url: '/api/promo/validate',
    payload: { cartId: '00000000-0000-4000-8000-000000000000', promoCode: 'GARDEN10' },
  });
  assert.equal(missingCart.statusCode, 404);
});
