import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createSeededAppFixture } from '../support/seededDatabase.js';
import { migrateDatabase } from '../../src/db/migrate.js';
import { createUnitOfWork } from '../../src/db/unitOfWork.js';
import { createAuditRepository } from '../../src/features/audit/auditRepository.js';
import { createAuditWriter } from '../../src/features/audit/auditService.js';
import { createBackInStockNotifyHandler } from '../../src/features/backInStock/backInStockNotifyHandler.js';
import {
  createBackInStockRepository,
  type BackInStockRepository,
} from '../../src/features/backInStock/backInStockRepository.js';
import { createBackInStockService } from '../../src/features/backInStock/backInStockService.js';
import { createProductRepository } from '../../src/features/catalog/productRepository.js';
import { createCountryProfileService } from '../../src/features/countryProfile/countryProfileService.js';
import { createInventoryRepository } from '../../src/features/inventory/inventoryRepository.js';
import { createInventoryService } from '../../src/features/inventory/inventoryService.js';
import type { JobHandlerResult } from '../../src/features/jobs/jobHandlerRegistry.js';
import { createNotificationRepository } from '../../src/features/notifications/notificationRepository.js';
import { createNotificationService } from '../../src/features/notifications/notificationService.js';

const NOW = '2026-08-05T10:00:00.000Z';

function cookie(response: { headers: Record<string, string | string[] | undefined> }): string {
  const value = response.headers['set-cookie'];
  const header = Array.isArray(value) ? value[0] : value;
  if (!header) throw new Error('Expected session cookie');
  return header.split(';', 1)[0]!;
}

void test('a persisted-CN subscriber sees a blocked retired lot as VARIANT_NOT_FOUND', async (t) => {
  const fixture = await createSeededAppFixture(t);
  const { db, app } = fixture;

  const signup = await app.inject({
    method: 'POST',
    url: '/signup',
    payload: {
      email: 'cn-back-in-stock@example.test',
      password: 'password-one',
      displayName: 'CN Buyer',
      country: 'CN',
    },
  });
  assert.equal(signup.statusCode, 201, signup.body);
  const variant = db
    .prepare(
      `SELECT v.id
       FROM product_variants v JOIN products p ON p.id = v.product_id
       WHERE p.category = 'Sports Nutrition'
       ORDER BY v.id LIMIT 1`,
    )
    .get() as { id: number } | undefined;
  assert.ok(variant);
  db.prepare('UPDATE product_variants SET active = 0, stock_count = 0 WHERE id = ?').run(
    variant.id,
  );

  const response = await app.inject({
    method: 'POST',
    url: '/api/back-in-stock',
    headers: {
      cookie: cookie(signup),
      'x-shop-country': 'US',
    },
    payload: { variantId: variant.id },
  });
  assert.equal(response.statusCode, 404, response.body);
  assert.equal(response.json<{ code: string }>().code, 'VARIANT_NOT_FOUND');
  assert.equal(
    (
      db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM back_in_stock_subscriptions s
           JOIN users u ON u.id = s.user_id
           WHERE u.email = ? AND s.variant_id = ?`,
        )
        .get('cn-back-in-stock@example.test', variant.id) as {
        count: number;
      }
    ).count,
    0,
  );
});

void test('a country block applied after row one settles is re-read during per-row fan-out', () => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-bis-country-drain-'));
  const db = new Database(join(directory, 'shop.db'));
  migrateDatabase(db);
  try {
    const clock = { now: () => new Date(NOW) };
    const unitOfWork = createUnitOfWork(db);
    const repository = createBackInStockRepository(db);
    const countryProfiles = createCountryProfileService();
    const auditRepository = createAuditRepository(db);
    const audit = createAuditWriter({ repository: auditRepository, clock });
    const inventory = createInventoryService({ repository: createInventoryRepository(db) });
    const jobs = { enqueue: () => ({ created: true }) as never };
    const notifications = createNotificationService({
      repository: createNotificationRepository(db),
      jobs,
      unitOfWork,
      audit,
      clock,
    });

    const productId = Number(
      (
        db
          .prepare(
            `INSERT INTO products
               (name, description, price_cents, category, stock_count, image_set_id, slug,
                compare_at_price_cents, sales_count, active, created_at)
             VALUES ('Drain Test Product', 'Test-only lot', 1000, 'Building Materials', 0, NULL,
                     'drain-test-product', NULL, 0, 1, ?)
             RETURNING id`,
          )
          .get(NOW) as { id: number }
      ).id,
    );
    const variantId = Number(
      (
        db
          .prepare(
            `INSERT INTO product_variants
               (product_id, sku, label, weight_grams, price_cents, compare_at_price_cents,
                clearance_price_cents, clearance_starts_at, clearance_ends_at, stock_count,
                backorderable, backorder_lead_days, delivery_class, active, sort_order, moq_sacks,
                created_at, updated_at)
             VALUES (?, 'BIS-COUNTRY-DRAIN', '25 kg sack', 25000, 1000, NULL, NULL, NULL, NULL,
                     0, 0, NULL, 'freight', 1, 1, 4, ?, ?)
             RETURNING id`,
          )
          .get(productId, NOW, NOW) as { id: number }
      ).id,
    );
    const addUser = (email: string, country: 'CN' | 'UK') =>
      Number(
        (
          db
            .prepare(
              `INSERT INTO users
                 (email, display_name, password_hash, password_salt, role, created_at, country)
               VALUES (?, 'Buyer', 'hash', 'salt', 'customer', ?, ?) RETURNING id`,
            )
            .get(email, NOW, country) as { id: number }
        ).id,
      );
    const firstCnBuyer = addUser('cn-drain-first@example.test', 'CN');
    const secondCnBuyer = addUser('cn-drain-second@example.test', 'CN');
    const service = createBackInStockService({
      repository,
      inventory,
      variants: createProductRepository(db),
      unitOfWork,
      audit,
      clock,
      countryProfiles,
    });
    const subscribe = (userId: number) => {
      const result = service.subscribe(userId, variantId, {
        actor: { type: 'user', userId },
        requestId: `subscribe-${userId}`,
      });
      assert.equal(result.ok, true);
      return Number((result as { value: { subscriptionId: string } }).value.subscriptionId);
    };
    const firstCnSubscription = subscribe(firstCnBuyer);
    const secondCnSubscription = subscribe(secondCnBuyer);
    assert.equal(repository.findOwned(firstCnSubscription, firstCnBuyer)?.status, 'pending');
    assert.equal(repository.findOwned(secondCnSubscription, secondCnBuyer)?.status, 'pending');
    db.prepare('UPDATE product_variants SET stock_count = 4 WHERE id = ?').run(variantId);

    let blockAppliedAfterFirstSettled = false;
    const drainingRepository: BackInStockRepository = {
      ...repository,
      findOwned(subscriptionId, userId) {
        const first = repository.findOwned(firstCnSubscription, firstCnBuyer);
        if (
          subscriptionId === secondCnSubscription &&
          first?.status === 'notified' &&
          !blockAppliedAfterFirstSettled
        ) {
          db.prepare("UPDATE products SET category = 'Sports Nutrition' WHERE id = ?").run(
            productId,
          );
          blockAppliedAfterFirstSettled = true;
        }
        return repository.findOwned(subscriptionId, userId);
      },
    };
    const handler = createBackInStockNotifyHandler({
      repository: drainingRepository,
      notifications,
      inventory,
      unitOfWork,
      audit,
      clock,
      faults: { isEnabled: () => false },
      countryProfiles,
    });

    const result = handler({
      jobId: 1,
      kind: 'back_in_stock.notify',
      payload: { variantId },
      attempt: 1,
    }) as JobHandlerResult;
    assert.deepEqual(result, { ok: true });
    assert.equal(blockAppliedAfterFirstSettled, true);
    assert.equal(repository.findOwned(firstCnSubscription, firstCnBuyer)?.status, 'notified');
    assert.equal(repository.findOwned(secondCnSubscription, secondCnBuyer)?.status, 'cancelled');
    assert.equal(notifications.list(firstCnBuyer).items.length, 1);
    assert.equal(notifications.list(secondCnBuyer).items.length, 0);
    assert.equal(
      auditRepository.list({ action: 'back_in_stock.cancelled', page: 1, pageSize: 25 }).length,
      1,
    );
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
