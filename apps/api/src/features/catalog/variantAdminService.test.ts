import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { closeDatabase, openDatabase, seedDatabase } from '../../db/index.js';
import { createUnitOfWork } from '../../db/unitOfWork.js';
import { createAuditRepository } from '../audit/auditRepository.js';
import { createAuditWriter } from '../audit/auditService.js';
import { createVariantAdminRepository } from './variantAdminRepository.js';
import { createVariantAdminService, VariantAdminError } from './variantAdminService.js';

function setup(t: test.TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'shop-variant-admin-'));
  const db = openDatabase({ path: join(directory, 'shop.db') });
  seedDatabase(db);
  t.after(() => {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });
  const clock = { now: () => new Date('2030-01-01T00:00:00.000Z') };
  const stockChanges: Array<{ variantId: number; occurredAt: string }> = [];
  return {
    db,
    stockChanges,
    service: createVariantAdminService({
      repository: createVariantAdminRepository(db),
      unitOfWork: createUnitOfWork(db),
      audit: createAuditWriter({ repository: createAuditRepository(db), clock }),
      clock,
      stockObserver: {
        stockChanged(variantId, occurredAt) {
          stockChanges.push({ variantId, occurredAt });
        },
      },
    }),
    context: { actor: { type: 'user' as const, userId: 3 }, requestId: 'variant-admin-test' },
  };
}

function createSoleVariantProduct(
  db: ReturnType<typeof openDatabase>,
  service: ReturnType<typeof createVariantAdminService>,
  context: { actor: { type: 'user'; userId: number }; requestId: string },
) {
  const product = db
    .prepare(
      `INSERT INTO products
        (name, description, price_cents, category, stock_count, image_url, created_at, slug,
         active, backorderable, consumption_classification)
       VALUES ('Variant retirement fixture', 'Fixture', 2_000, 'Trade & Creative Materials',
               7, '', '2030-01-01T00:00:00.000Z', ?, 1, 0, 'non-food')
       RETURNING id`,
    )
    .get(`variant-retirement-${crypto.randomUUID()}`) as { id: number };
  const variant = service.create(
    {
      productId: product.id,
      sku: `VARIANT-RETIRE-${crypto.randomUUID()}`,
      label: 'Fixture lot',
      weightGrams: 25_000,
      priceCents: 2_000,
      stockCount: 7,
      deliveryClass: 'freight',
      sortOrder: 1,
      moqSacks: 4,
    },
    context,
  );
  db.prepare('UPDATE products SET default_variant_id = ? WHERE id = ?').run(variant.id, product.id);
  return { product, variant };
}

void test('variant admin creates, updates, retires, and emits one audit row per command', (t) => {
  const { db, service, context } = setup(t);
  const created = service.create(
    {
      productId: 1,
      sku: 'ADMIN-TEST-LOT',
      label: 'Admin test lot',
      weightGrams: 25_000,
      priceCents: 2_000,
      stockCount: 7,
      deliveryClass: 'freight',
      sortOrder: 3,
      moqSacks: 4,
    },
    context,
  );
  const updated = service.update(created.id, { priceCents: 2_100, moqSacks: 5 }, context);
  const retired = service.retire(created.id, context);
  assert.equal(updated.price_cents, 2_100);
  assert.equal(retired.active, 0);
  assert.equal(retired.sort_order, 0);
  assert.equal(
    (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM audit_events WHERE entity_type = 'variant' AND entity_id = ?",
        )
        .get(String(created.id)) as { count: number }
    ).count,
    3,
  );
});

void test('a stock write notifies the stock observer; a patch without stockCount does not', (t) => {
  const { db, service, stockChanges, context } = setup(t);
  const variant = createSoleVariantProduct(db, service, context).variant;
  assert.deepEqual(stockChanges, [
    { variantId: variant.id, occurredAt: '2030-01-01T00:00:00.000Z' },
  ]);

  service.update(variant.id, { stockCount: 0 }, context);
  assert.deepEqual(stockChanges.slice(1), [
    { variantId: variant.id, occurredAt: '2030-01-01T00:00:00.000Z' },
  ]);

  service.update(variant.id, { priceCents: 2_500, label: 'Renamed lot' }, context);
  service.setClearance(
    variant.id,
    { priceCents: 1, startsAt: '2030-01-02T00:00:00.000Z', endsAt: '2030-01-03T00:00:00.000Z' },
    context,
  );
  assert.equal(stockChanges.length, 2);
});

void test('an absent stock observer leaves variant admin commands working unchanged', (t) => {
  const { db } = setup(t);
  const clock = { now: () => new Date('2030-01-01T00:00:00.000Z') };
  const service = createVariantAdminService({
    repository: createVariantAdminRepository(db),
    unitOfWork: createUnitOfWork(db),
    audit: createAuditWriter({ repository: createAuditRepository(db), clock }),
    clock,
  });
  const context = { actor: { type: 'user' as const, userId: 3 }, requestId: 'variant-admin-plain' };
  const variant = createSoleVariantProduct(db, service, context).variant;
  assert.equal(service.update(variant.id, { stockCount: 3 }, context).stock_count, 3);
});

void test('retiring default promotes lowest-sort active sibling and keeps it customer-usable', (t) => {
  const { db, service, context } = setup(t);
  const fixture = createSoleVariantProduct(db, service, context);
  const defaultVariant = { id: fixture.variant.id, product_id: fixture.product.id };
  const replacement = service.create(
    {
      productId: defaultVariant.product_id,
      sku: 'ADMIN-REPLACEMENT-2',
      label: 'Replacement two',
      weightGrams: 25_000,
      priceCents: 2_000,
      stockCount: 7,
      deliveryClass: 'freight',
      sortOrder: 2,
      moqSacks: 4,
    },
    context,
  );
  const finalReplacement = service.create(
    {
      productId: defaultVariant.product_id,
      sku: 'ADMIN-REPLACEMENT-3',
      label: 'Replacement three',
      weightGrams: 25_000,
      priceCents: 2_000,
      stockCount: 7,
      deliveryClass: 'freight',
      sortOrder: 3,
      moqSacks: 4,
    },
    context,
  );

  service.retire(defaultVariant.id, context);
  service.retire(replacement.id, context);
  assert.deepEqual(
    db
      .prepare('SELECT default_variant_id FROM products WHERE id = ?')
      .get(defaultVariant.product_id),
    { default_variant_id: finalReplacement.id },
  );
  assert.deepEqual(
    db
      .prepare(
        `SELECT id, active FROM product_variants
         WHERE id = (SELECT default_variant_id FROM products WHERE id = ?)`,
      )
      .get(defaultVariant.product_id),
    { id: finalReplacement.id, active: 1 },
  );
  assert.deepEqual(
    db
      .prepare('SELECT active, sort_order FROM product_variants WHERE id IN (?, ?) ORDER BY id')
      .all(defaultVariant.id, replacement.id),
    [
      { active: 0, sort_order: 0 },
      { active: 0, sort_order: 0 },
    ],
  );
});

void test('retiring a sole active variant rejects without mutating it', (t) => {
  const { db, service, context } = setup(t);
  const variant = createSoleVariantProduct(db, service, context).variant;
  assert.throws(
    () => service.retire(variant.id, context),
    (error: unknown) =>
      error instanceof VariantAdminError && error.code === 'VARIANT_NO_ACTIVE_REPLACEMENT',
  );
  assert.deepEqual(
    db.prepare('SELECT active, sort_order FROM product_variants WHERE id = ?').get(variant.id),
    {
      active: 1,
      sort_order: 1,
    },
  );
});

void test('variant clearance is atomic, probes its start boundary, and clears as one mutation', (t) => {
  const { db, service, context } = setup(t);
  const variant = db
    .prepare('SELECT id FROM product_variants WHERE active = 1 ORDER BY id LIMIT 1')
    .get() as {
    id: number;
  };
  const set = service.setClearance(
    variant.id,
    {
      priceCents: 1,
      startsAt: '2030-01-02T01:00:00.000+01:00',
      endsAt: '2030-01-03T00:00:00.000Z',
    },
    context,
  );
  assert.equal(set.clearance_price_cents, 1);
  assert.equal(set.clearance_starts_at, '2030-01-02T00:00:00.000Z');
  const cleared = service.setClearance(variant.id, null, context);
  assert.deepEqual(
    [cleared.clearance_price_cents, cleared.clearance_starts_at, cleared.clearance_ends_at],
    [null, null, null],
  );
  assert.throws(
    () =>
      service.setClearance(
        variant.id,
        { priceCents: 1, startsAt: '2030-01-03T00:00:00.000Z', endsAt: '2030-01-02T00:00:00.000Z' },
        context,
      ),
    (error: unknown) => error instanceof VariantAdminError && error.code === 'INVALID_CLEARANCE',
  );
  assert.equal(
    (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM audit_events WHERE action IN ('variant.clearance_set', 'variant.clearance_cleared')",
        )
        .get() as { count: number }
    ).count,
    2,
  );
});
