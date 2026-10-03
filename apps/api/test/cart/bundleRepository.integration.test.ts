import assert from 'node:assert/strict';
import test from 'node:test';
import { openDatabase } from '../../src/db/index.js';
import { createBundleRepository } from '../../src/features/bundles/bundleRepository.js';
import { createCartRepository } from '../../src/features/cart/cartRepository.js';
import { createCart } from '../../src/features/cart/cartService.js';
import { openSeededDatabase } from '../support/seededDatabase.js';

function defaultVariantId(db: ReturnType<typeof openDatabase>, productId: number): string {
  const row = db
    .prepare(
      'SELECT id FROM product_variants WHERE product_id = ? AND sort_order = 1 AND active = 1 LIMIT 1',
    )
    .get(productId) as { id: number } | undefined;
  if (!row) throw new Error(`No default variant for product ${productId}`);
  return String(row.id);
}

void test('bundle repository hydrates ordered persisted products and filters by component', (t) => {
  const { db } = openSeededDatabase(t);

  const bundles = createBundleRepository(db);
  assert.deepEqual(
    bundles
      .list()
      .map((bundle) => [
        bundle.id,
        bundle.key,
        bundle.components.map((component) => component.productId),
      ]),
    [
      [1, 'protein-starter-pack', [8, 9, 13]],
      [2, 'baking-essentials', [1, 3, 1016, 1035]],
      [3, 'garden-care-kit', [27, 28, 31]],
      [4, 'cleaning-supplies-bundle', [22, 26, 43]],
      [5, 'casting-workshop-kit', [34, 36, 38]],
      [6, 'drinks-sampler', [14, 18, 16]],
    ],
  );
  assert.deepEqual(
    bundles.list('28').map((bundle) => bundle.key),
    ['garden-care-kit'],
  );
  assert.deepEqual(
    bundles.list('999').map((bundle) => bundle.key),
    [],
  );

  db.prepare('UPDATE products SET active = 0, price_cents = 4321 WHERE id = 8').run();
  const starter = bundles.findById('1');
  assert.equal(starter?.active, 1);
  assert.equal(starter?.components[0]?.product?.active, 0);
  assert.equal(starter?.components[0]?.product?.price_cents, 4321);
});

void test('cart repository reads and increments ordinary line quantities', (t) => {
  const { db } = openSeededDatabase(t);

  const carts = createCartRepository(db);
  const variant1 = defaultVariantId(db, 1);
  const { cartId } = createCart(carts);
  assert.equal(carts.lineQuantity(cartId, variant1), 0);
  carts.addLineQuantity(cartId, variant1, 3);
  carts.addLineQuantity(cartId, variant1, 2);
  assert.equal(carts.lineQuantity(cartId, variant1), 5);
  carts.addLine(cartId, variant1);
  assert.equal(carts.lineQuantity(cartId, variant1), 6);
});
