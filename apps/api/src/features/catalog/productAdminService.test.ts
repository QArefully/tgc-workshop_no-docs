import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { closeDatabase, openDatabase } from '../../db/index.js';
import { createUnitOfWork } from '../../db/unitOfWork.js';
import { createAuditRepository } from '../audit/auditRepository.js';
import { createAuditWriter } from '../audit/auditService.js';
import { createProductAdminRepository } from './productAdminRepository.js';
import {
  createProductAdminService,
  ProductAdminError,
  type ProductAdminCreateInput,
  type ProductAdminPatch,
} from './productAdminService.js';

const NOW = '2026-07-29T09:00:00.000Z';
const context = { actor: { type: 'system' as const, userId: null }, requestId: null };

function body(overrides: Partial<ProductAdminCreateInput> = {}): ProductAdminCreateInput {
  return {
    name: 'Ground Limestone',
    description: 'Fine mineral filler for trade use.',
    priceCents: 12500,
    category: 'Trade & Creative Materials',
    stockCount: 20,
    imageSetId: 'limestone',
    slug: 'ground-limestone',
    consumptionClassification: 'non-food',
    mixingGroup: 'cementitious-materials',
    ...overrides,
  };
}

void test('product admin service persists admin commands with one audit event each', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'shop-product-admin-'));
  const db = openDatabase({ path: join(dir, 'shop.db') });
  t.after(() => {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });

  const service = createProductAdminService({
    repository: createProductAdminRepository(db),
    unitOfWork: createUnitOfWork(db),
    audit: createAuditWriter({
      repository: createAuditRepository(db),
      clock: { now: () => new Date(NOW) },
    }),
    clock: { now: () => new Date(NOW) },
  });

  await t.test('create, update, and retire keep the row and emit one event per command', () => {
    const created = service.create(body(), context);
    assert.equal(created.active, 1);
    assert.equal(
      service.listAdmin().some((product) => product.id === created.id),
      true,
    );

    const updated = service.update(created.id, { name: 'Ground Limestone Filler' }, context);
    assert.equal(updated.name, 'Ground Limestone Filler');

    const retired = service.retire(created.id, context);
    assert.equal(retired.active, 0);
    assert.equal(service.getAdmin(created.id)?.id, created.id);
    assert.equal(
      service.listAdmin().some((product) => product.id === created.id),
      false,
    );
    assert.equal(
      service.listAdmin({ includeRetired: true }).some((product) => product.id === created.id),
      true,
    );

    const actions = db
      .prepare(
        'SELECT action FROM audit_events WHERE entity_type = ? AND entity_id = ? ORDER BY id',
      )
      .all('product', String(created.id)) as Array<{ action: string }>;
    assert.deepEqual(
      actions.map((event) => event.action),
      ['product.created', 'product.updated', 'product.retired'],
    );
  });

  await t.test('slug is unique within a category and mixing group is allowlisted', () => {
    service.create(body({ slug: 'same-slug' }), context);
    assert.throws(
      () => service.create(body({ name: 'Other limestone', slug: 'same-slug' }), context),
      { name: 'ProductAdminError', code: 'DUPLICATE_SLUG' },
    );
    assert.doesNotThrow(() =>
      service.create(
        body({ name: 'Pantry limestone', category: 'Baking & Pantry', slug: 'same-slug' }),
        context,
      ),
    );
    assert.throws(
      () => service.create(body({ slug: 'invalid-mixing-group', mixingGroup: 'unknown' }), context),
      ProductAdminError,
    );
  });

  await t.test('category and compare-at price are validated on create and update', () => {
    assert.throws(
      () =>
        service.create(
          { ...body(), category: 'Unknown category' } as unknown as ProductAdminCreateInput,
          context,
        ),
      { name: 'ProductAdminError', code: 'INVALID_INPUT' },
    );
    assert.throws(() => service.create(body({ compareAtPriceCents: -1 }), context), {
      name: 'ProductAdminError',
      code: 'INVALID_INPUT',
    });

    const product = service.create(body({ slug: 'validated-limestone' }), context);
    assert.throws(
      () =>
        service.update(
          product.id,
          { category: 'Unknown category' } as unknown as ProductAdminPatch,
          context,
        ),
      { name: 'ProductAdminError', code: 'INVALID_INPUT' },
    );
    assert.throws(() => service.update(product.id, { compareAtPriceCents: Number.NaN }, context), {
      name: 'ProductAdminError',
      code: 'INVALID_INPUT',
    });
  });

  await t.test('retiring an ordered product is non-destructive and retains order history', () => {
    const product = service.create(body({ slug: 'ordered-limestone' }), context);
    db.prepare(
      `INSERT INTO orders
        (customer_name, customer_email, shipping_address, subtotal_cents, discount_cents, total_cents, created_at)
       VALUES ('Buyer', 'buyer@example.test', '1 Yard Lane', 12500, 0, 12500, ?)`,
    ).run(NOW);
    const orderId = (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
    db.prepare(
      `INSERT INTO order_line_items
        (order_id, product_id, product_name, product_price_cents, quantity, line_total_cents)
       VALUES (?, ?, ?, ?, 1, ?)`,
    ).run(orderId, product.id, product.name, product.price_cents, product.price_cents);

    const retired = service.retire(product.id, context);
    assert.equal(retired.active, 0);
    assert.equal(
      (
        db
          .prepare('SELECT COUNT(*) AS count FROM order_line_items WHERE product_id = ?')
          .get(product.id) as {
          count: number;
        }
      ).count,
      1,
    );
  });
});
