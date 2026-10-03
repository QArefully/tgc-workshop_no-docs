import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import type { PostalAddress } from '@shop/contracts/address';
import { Order, OrderSummary } from '@shop/contracts/orders';
import type { BillingEntitySnapshot } from '@shop/contracts/trade-account';
import { closeDatabase, openDatabase } from '../../src/db/index.js';
import { createOrderRepository } from '../../src/features/orders/orderRepository.js';
import type { CreateOrderParams } from '../../src/features/orders/orderTypes.js';

const CREATED_AT = '2026-07-27T09:00:00.000Z';

const address: PostalAddress = {
  line1: '9 Wharf Road',
  city: 'Leeds',
  postcode: 'LS1 4AP',
  countryCode: 'GB',
};

const billingEntity: BillingEntitySnapshot = {
  legalName: 'Depth Holdings Ltd',
  registrationNumber: '09876543',
  vatNumber: null,
  address,
};

function orderParams(overrides: Partial<CreateOrderParams> = {}): CreateOrderParams {
  return {
    customerName: 'Depth Buyer',
    customerEmail: 'depth@example.test',
    shippingAddress: '9 Wharf Road, Leeds, LS1 4AP, GB',
    promoApplied: null,
    subtotalCents: 5000,
    discountCents: 0,
    totalCents: 5000,
    userId: null,
    items: [
      {
        productId: '1',
        productName: 'Test material',
        unitPriceCents: 1250,
        quantity: 4,
        discountableTotalCents: 5000,
        blendingFeeCents: 0,
        lineTotalCents: 5000,
      },
    ],
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function createUser(db: import('better-sqlite3').Database, email: string): number {
  return Number(
    db
      .prepare(
        `INSERT INTO users (email, display_name, password_hash, password_salt, role, created_at)
         VALUES (?, 'Depth Test', 'hash', '', 'customer', '2026-07-27T09:00:00.000Z')`,
      )
      .run(email).lastInsertRowid,
  );
}

void test('order delivery, billing, slot, and reference persistence', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'shop-order-delivery-'));
  const db = openDatabase({ path: join(dir, 'shop.db') });
  t.after(() => {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });

  const repository = createOrderRepository(db);
  const userId = createUser(db, 'order-depth@example.test');

  await t.test('a fully populated order round-trips every new field', () => {
    const orderId = repository.create(
      orderParams({
        userId,
        deliveryAddress: address,
        billingEntity,
        deliverySlot: { date: '2026-08-03', window: 'pm' },
        purchaseOrderReference: 'PO-4417',
        promoApplied: 'GARDEN10',
        promoCategoryScope: 'Garden & Outdoors',
        discountBaseCents: 4_000,
      }),
    );
    const order = repository.findById(orderId);
    assert.ok(order);
    assert.deepEqual(order.deliveryAddress, address);
    assert.deepEqual(order.billingEntity, billingEntity);
    assert.deepEqual(order.deliverySlot, { date: '2026-08-03', window: 'pm' });
    assert.equal(order.purchaseOrderReference, 'PO-4417');
    assert.equal(order.promoCategoryScope, 'Garden & Outdoors');
    assert.equal(order.discountBaseCents, 4_000);
    assert.equal(Value.Check(Order, order), true);
  });

  await t.test('an order without the new fields hydrates them as genuinely absent', () => {
    const orderId = repository.create(orderParams({ userId }));
    const order = repository.findById(orderId);
    assert.ok(order);
    // Absent, not empty: the contract fields are optional and must not materialise as blanks.
    assert.equal('deliveryAddress' in order && order.deliveryAddress !== undefined, false);
    assert.equal(order.billingEntity, undefined);
    assert.equal(order.deliverySlot, undefined);
    assert.equal(order.purchaseOrderReference, undefined);
    assert.equal(order.promoCategoryScope, undefined);
    assert.equal(order.discountBaseCents, undefined);
    assert.equal(Value.Check(Order, order), true);
  });

  await t.test('the order list carries the purchase order reference when present', () => {
    const listUserId = createUser(db, 'order-depth-list@example.test');
    repository.create(orderParams({ userId: listUserId, purchaseOrderReference: 'PO-LIST-1' }));
    repository.create(orderParams({ userId: listUserId }));

    // Scoped to this test's own user: the database carries orders owned by other suites.
    const { items, total } = repository.listOwned(listUserId, 1, 10);
    assert.equal(total, 2);
    assert.deepEqual(items.map((item) => item.purchaseOrderReference).sort(), [
      'PO-LIST-1',
      undefined,
    ]);
    for (const item of items) assert.equal(Value.Check(OrderSummary, item), true);
  });

  await t.test('a corrupt address snapshot fails closed rather than hydrating', () => {
    const orderId = repository.create(orderParams({ userId, deliveryAddress: address }));
    db.prepare('UPDATE orders SET delivery_address_json = ? WHERE id = ?').run(
      JSON.stringify({ line1: '' }),
      orderId,
    );
    assert.throws(() => repository.findById(orderId), /invalid delivery address snapshot/);

    // Restore the valid snapshot: later reads in this suite must not inherit the corruption.
    db.prepare('UPDATE orders SET delivery_address_json = ? WHERE id = ?').run(
      JSON.stringify(address),
      orderId,
    );
    assert.deepEqual(repository.findById(orderId)?.deliveryAddress, address);
  });

  await t.test('a half-written slot pair is corruption, not a partial booking', () => {
    const orderId = repository.create(orderParams({ userId }));
    db.prepare('UPDATE orders SET delivery_slot_date = ? WHERE id = ?').run('2026-08-03', orderId);
    assert.throws(() => repository.findById(orderId), /invalid delivery slot/);
  });
});
