/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { standingOrderCompletedCopy } from '@shop/localisation/messages/asyncContent';
import { migrateDatabase } from '../../src/db/migrate.js';
import { createUnitOfWork } from '../../src/db/unitOfWork.js';
import { createAuditRepository } from '../../src/features/audit/auditRepository.js';
import { createAuditWriter } from '../../src/features/audit/auditService.js';
import { noFaults } from '../../src/features/jobs/faultSwitch.js';
import { createStandingOrderRepository } from '../../src/features/standingOrders/standingOrderRepository.js';
import { createStandingOrderService } from '../../src/features/standingOrders/standingOrderService.js';

const system = { actor: { type: 'system' as const, userId: null }, requestId: null };

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'shop-standing-orders-'));
  const db = new Database(join(directory, 'shop.db'));
  migrateDatabase(db);
  let now = new Date('2026-01-31T09:30:00.000Z');
  let savedAvailable = true;
  let orderAvailable = true;
  let orderOwner: number | undefined;
  let savedSucceeds = true;
  const carts: string[] = [];
  const notificationsSent: Array<{ userId: number; title: string; body: string }> = [];
  const repository = createStandingOrderRepository(db);
  const auditRepository = createAuditRepository(db);
  const service = createStandingOrderService({
    repository,
    savedLists: {
      get: () => (savedAvailable ? ({ ok: true } as any) : ({ ok: false } as any)),
      addToCart: () =>
        !savedAvailable
          ? ({ ok: false, code: 'LIST_NOT_FOUND' } as any)
          : savedSucceeds
            ? ({
                ok: true,
                value: {
                  outcomes: [
                    {
                      itemId: '1',
                      productId: '1',
                      productName: 'Material',
                      variantId: 1,
                      sku: 'MAT-001',
                      submittedQuantity: 4,
                      savedQuantity: 4,
                      status: 'added',
                      reason: null,
                      resolvedUnitPriceCents: 100,
                    },
                    {
                      itemId: '2',
                      productId: '2',
                      productName: 'Retired',
                      variantId: 2,
                      sku: 'MAT-002',
                      submittedQuantity: null,
                      savedQuantity: 4,
                      status: 'skipped',
                      reason: 'VARIANT_RETIRED',
                      resolvedUnitPriceCents: null,
                    },
                  ],
                },
              } as any)
            : ({ ok: false, code: 'CART_RESERVED' } as any),
    },
    orders: {
      getOwned: (_orderId, userId) =>
        orderAvailable && userId === orderOwner ? ({} as any) : undefined,
    },
    reorder: {
      reorder: () =>
        ({
          ok: true,
          value: {
            outcomes: [
              {
                orderLineItemId: '1',
                productId: '1',
                productName: 'Material',
                variantId: 1,
                sku: 'MAT-001',
                configKey: '',
                quantity: 4,
                status: 'added',
                reason: null,
                orderedUnitPriceCents: 100,
                currentUnitPriceCents: 100,
                priceChanged: false,
              },
            ],
          },
        }) as any,
    },
    carts: { create: () => ({ cartId: `cart-${carts.push('cart')}` }) },
    jobs: {
      enqueue: (input) => {
        const existing = db
          .prepare('SELECT id FROM jobs WHERE dedupe_key=?')
          .get(input.dedupeKey ?? null) as { id: number } | undefined;
        if (existing) return { created: false, job: { id: existing.id } } as any;
        const at = now.toISOString();
        const inserted = db
          .prepare(
            "INSERT INTO jobs (kind, dedupe_key, payload_json, status, max_attempts, run_at, created_at, updated_at) VALUES (?, ?, ?, 'pending', 3, ?, ?, ?)",
          )
          .run(
            input.kind,
            input.dedupeKey ?? null,
            JSON.stringify(input.payload),
            input.runAt,
            at,
            at,
          );
        return { created: true, job: { id: Number(inserted.lastInsertRowid) } } as any;
      },
    },
    notifications: {
      notify: (input) => {
        notificationsSent.push({ userId: input.userId, title: input.title, body: input.body });
        return { created: true };
      },
    },
    audit: createAuditWriter({ repository: auditRepository, clock: { now: () => now } }),
    unitOfWork: createUnitOfWork(db),
    clock: { now: () => now },
    faults: noFaults,
    countryForUser: (userId) =>
      db.prepare('SELECT country FROM users WHERE id = ?').pluck().get(userId) as
        'UK' | 'DE' | 'FR' | undefined,
  });
  const addUser = (email: string, country: 'UK' | 'DE' | 'FR' = 'UK') =>
    Number(
      (
        db
          .prepare(
            "INSERT INTO users (email, display_name, password_hash, password_salt, role, country) VALUES (?, 'Buyer', 'hash', 'salt', 'customer', ?) RETURNING id",
          )
          .get(email, country) as { id: number }
      ).id,
    );
  const addSources = (userId: number) => {
    const at = now.toISOString();
    const listId = Number(
      (
        db
          .prepare(
            'INSERT INTO saved_lists (user_id, name, is_default, created_at, updated_at) VALUES (?, ?, 0, ?, ?) RETURNING id',
          )
          .get(userId, `List ${userId}`, at, at) as { id: number }
      ).id,
    );
    const orderId = Number(
      (
        db
          .prepare(
            "INSERT INTO orders (customer_name, customer_email, shipping_address, subtotal_cents, discount_cents, total_cents, user_id, created_at) VALUES ('Buyer', 'buyer@example.test', '1 Test Street', 0, 0, 0, ?, ?) RETURNING id",
          )
          .get(userId, at) as { id: number }
      ).id,
    );
    orderOwner = userId;
    return { listId: String(listId), orderId: String(orderId) };
  };
  const addJob = (id: number) => {
    const at = now.toISOString();
    db.prepare(
      "INSERT INTO jobs (id, kind, payload_json, status, max_attempts, run_at, created_at, updated_at) VALUES (?, 'standing_order.run', '{}', 'pending', 3, ?, ?, ?)",
    ).run(id, at, at, at);
  };
  return {
    db,
    auditRepository,
    repository,
    service,
    carts,
    notificationsSent,
    addUser,
    addSources,
    addJob,
    setNow(value: string) {
      now = new Date(value);
    },
    setSavedAvailable(value: boolean) {
      savedAvailable = value;
    },
    setOrderAvailable(value: boolean) {
      orderAvailable = value;
    },
    setSavedSucceeds(value: boolean) {
      savedSucceeds = value;
    },
    close() {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

void test('runs saved-list and order sources once, retaining outcomes and completion state', () => {
  const f = fixture();
  try {
    const owner = f.addUser('standing-owner@example.test');
    const source = f.addSources(owner);
    const saved = f.service.create(
      owner,
      { name: 'Saved', source: { kind: 'saved_list', listId: source.listId }, cadence: 'monthly' },
      system,
    );
    const order = f.service.create(
      owner,
      { name: 'Order', source: { kind: 'order', orderId: source.orderId }, cadence: 'weekly' },
      system,
    );
    assert.equal(saved.ok, true);
    assert.equal(order.ok, true);
    f.addJob(10);
    f.addJob(11);
    assert.deepEqual(
      f.service.runJob(10, {
        standingOrderId: Number(saved.value.id),
        scheduledRunAt: saved.value.nextRunAt,
      }),
      { ok: true },
    );
    assert.deepEqual(
      f.service.runJob(11, {
        standingOrderId: Number(order.value.id),
        scheduledRunAt: order.value.nextRunAt,
      }),
      { ok: true },
    );
    assert.equal(f.carts.length, 2);
    const savedRun = f.repository.findRunForJob(10)!;
    assert.deepEqual(
      {
        status: savedRun.status,
        added: savedRun.added_line_count,
        skipped: savedRun.skipped_line_count,
      },
      { status: 'completed', added: 1, skipped: 1 },
    );
    assert.match(
      f.repository.find(Number(saved.value.id))!.last_run_at!,
      /^2026-01-31T09:30:00\.000Z$/,
    );
    assert.equal(
      f.repository.find(Number(saved.value.id))!.next_run_at,
      '2026-03-31T09:30:00.000Z',
    );
    assert.deepEqual(
      f.service.runJob(10, {
        standingOrderId: Number(saved.value.id),
        scheduledRunAt: saved.value.nextRunAt,
      }),
      { ok: true },
    );
    assert.equal(f.carts.length, 2, 'completed job retries must not create another cart');
  } finally {
    f.close();
  }
});

void test('inactive jobs no-op, failures can retry, and deleted or foreign sources cannot be used', () => {
  const f = fixture();
  try {
    const owner = f.addUser('standing-owner-2@example.test');
    const other = f.addUser('standing-other@example.test');
    const source = f.addSources(owner);
    f.setOrderAvailable(false);
    assert.deepEqual(
      f.service.create(
        other,
        { name: 'Foreign', source: { kind: 'order', orderId: source.orderId }, cadence: 'weekly' },
        system,
      ),
      { ok: false, code: 'SOURCE_NOT_FOUND' },
    );
    f.setOrderAvailable(true);
    const inactive = f.service.create(
      owner,
      { name: 'Inactive', source: { kind: 'order', orderId: source.orderId }, cadence: 'weekly' },
      system,
    );
    assert.equal(inactive.ok, true);
    f.service.update(owner, Number(inactive.value.id), { active: false }, system);
    f.addJob(20);
    assert.deepEqual(
      f.service.runJob(20, {
        standingOrderId: Number(inactive.value.id),
        scheduledRunAt: inactive.value.nextRunAt,
      }),
      { ok: true },
    );
    assert.equal(f.carts.length, 0);
    assert.equal(f.repository.findRunForJob(20), undefined);
    const retry = f.service.create(
      owner,
      { name: 'Retry', source: { kind: 'saved_list', listId: source.listId }, cadence: 'weekly' },
      system,
    );
    assert.equal(retry.ok, true);
    f.addJob(21);
    f.setSavedSucceeds(false);
    assert.deepEqual(
      f.service.runJob(21, {
        standingOrderId: Number(retry.value.id),
        scheduledRunAt: retry.value.nextRunAt,
      }),
      { ok: false, error: 'CART_RESERVED' },
    );
    assert.equal(f.repository.find(Number(retry.value.id))!.next_run_at, retry.value.nextRunAt);
    f.setSavedSucceeds(true);
    assert.deepEqual(
      f.service.runJob(21, {
        standingOrderId: Number(retry.value.id),
        scheduledRunAt: retry.value.nextRunAt,
      }),
      { ok: true },
    );
    const deleted = f.service.create(
      owner,
      { name: 'Deleted', source: { kind: 'saved_list', listId: source.listId }, cadence: 'weekly' },
      system,
    );
    assert.equal(deleted.ok, true);
    f.setSavedAvailable(false);
    f.addJob(22);
    assert.deepEqual(
      f.service.runJob(22, {
        standingOrderId: Number(deleted.value.id),
        scheduledRunAt: deleted.value.nextRunAt,
      }),
      { ok: false, error: 'LIST_NOT_FOUND' },
    );
  } finally {
    f.close();
  }
});

void test('due schedules are enqueued once per standing-order timestamp', () => {
  const f = fixture();
  try {
    const owner = f.addUser('standing-owner-3@example.test');
    const source = f.addSources(owner);
    const created = f.service.create(
      owner,
      { name: 'Due', source: { kind: 'saved_list', listId: source.listId }, cadence: 'weekly' },
      system,
    );
    assert.equal(created.ok, true);
    f.setNow('2026-02-07T09:30:00.000Z');
    assert.equal(f.service.enqueueDue(), 1);
    assert.equal(f.service.enqueueDue(), 0);
  } finally {
    f.close();
  }
});

void test('run-now records a single pending run and scopes run history to its owner', () => {
  const f = fixture();
  try {
    const owner = f.addUser('standing-owner-4@example.test');
    const other = f.addUser('standing-other-4@example.test');
    const source = f.addSources(owner);
    const created = f.service.create(
      owner,
      { name: 'Manual', source: { kind: 'saved_list', listId: source.listId }, cadence: 'weekly' },
      system,
    );
    assert.equal(created.ok, true);
    const context = {
      actor: { type: 'user' as const, userId: owner },
      requestId: 'manual-run-now',
    };
    const first = f.service.runNow(owner, Number(created.value.id), context);
    assert.equal(first.ok, true);
    assert.deepEqual(
      { status: first.value.status, jobId: first.value.jobId, runAt: first.value.runAt },
      { status: 'pending', jobId: '1', runAt: '2026-01-31T09:30:00.000Z' },
    );
    const duplicate = f.service.runNow(owner, Number(created.value.id), context);
    assert.equal(duplicate.ok, true);
    assert.equal(duplicate.value.id, first.value.id);
    assert.equal(
      (f.db.prepare('SELECT count(*) AS count FROM jobs').get() as { count: number }).count,
      1,
    );
    const runStartedAudits = f.auditRepository.list({
      action: 'standing_order.run_started',
      page: 1,
      pageSize: 25,
    });
    assert.equal(runStartedAudits.length, 1);
    assert.deepEqual(
      {
        action: runStartedAudits[0]!.action,
        actorType: runStartedAudits[0]!.actorType,
        actorUserId: runStartedAudits[0]!.actorUserId,
        requestId: runStartedAudits[0]!.requestId,
        entityId: runStartedAudits[0]!.entityId,
      },
      {
        action: 'standing_order.run_started',
        actorType: 'user',
        actorUserId: owner,
        requestId: 'manual-run-now',
        entityId: created.value.id,
      },
    );
    assert.equal(
      (f.db.prepare('SELECT count(*) AS count FROM standing_order_runs').get() as { count: number })
        .count,
      1,
    );
    assert.deepEqual(f.service.listRuns(owner, Number(created.value.id)), [first.value]);
    assert.deepEqual(f.service.listRuns(other, Number(created.value.id)), []);
    assert.deepEqual(f.service.runNow(other, Number(created.value.id), system), {
      ok: false,
      code: 'NOT_FOUND',
    });
    assert.equal(
      f.service.update(owner, Number(created.value.id), { active: false }, system).ok,
      true,
    );
    assert.deepEqual(f.service.runNow(owner, Number(created.value.id), system), {
      ok: false,
      code: 'INACTIVE',
    });
  } finally {
    f.close();
  }
});

void test('standing-order completion snapshots use each owner country', () => {
  const f = fixture();
  try {
    const de = f.addUser('standing-de@example.test', 'DE');
    const fr = f.addUser('standing-fr@example.test', 'FR');
    const deSource = f.addSources(de);
    const frSource = f.addSources(fr);
    const deOrder = f.service.create(
      de,
      {
        name: 'DE restock',
        source: { kind: 'saved_list', listId: deSource.listId },
        cadence: 'weekly',
      },
      system,
    );
    const frOrder = f.service.create(
      fr,
      {
        name: 'FR restock',
        source: { kind: 'saved_list', listId: frSource.listId },
        cadence: 'weekly',
      },
      system,
    );
    assert.equal(deOrder.ok, true);
    assert.equal(frOrder.ok, true);
    f.addJob(30);
    f.addJob(31);
    assert.deepEqual(
      f.service.runJob(30, {
        standingOrderId: Number(deOrder.value.id),
        scheduledRunAt: deOrder.value.nextRunAt,
      }),
      { ok: true },
    );
    assert.deepEqual(
      f.service.runJob(31, {
        standingOrderId: Number(frOrder.value.id),
        scheduledRunAt: frOrder.value.nextRunAt,
      }),
      { ok: true },
    );
    const deCopy = standingOrderCompletedCopy('DE', 1);
    const frCopy = standingOrderCompletedCopy('FR', 1);
    assert.deepEqual(f.notificationsSent, [
      { userId: de, title: deCopy.title, body: deCopy.body },
      { userId: fr, title: frCopy.title, body: frCopy.body },
    ]);
  } finally {
    f.close();
  }
});
