import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { closeDatabase, openDatabase } from '../../db/index.js';
import { createUnitOfWork } from '../../db/unitOfWork.js';
import { createAuditRepository } from '../audit/auditRepository.js';
import { createAuditWriter } from '../audit/auditService.js';
import { createPromoAdminRepository } from './promoAdminRepository.js';
import { createPromoAdminService, PromoAdminServiceError } from './promoAdminService.js';

function fixture(t: test.TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'shop-promo-admin-'));
  const db = openDatabase({ path: join(directory, 'shop.db') });
  t.after(() => {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });
  const repository = createPromoAdminRepository(db);
  const audit = createAuditWriter({
    repository: createAuditRepository(db),
    clock: { now: () => new Date('2026-07-29T10:00:00.000Z') },
  });
  return {
    db,
    service: createPromoAdminService({ repository, unitOfWork: createUnitOfWork(db), audit }),
    context: { actor: { type: 'user' as const, userId: 3 }, requestId: 'promo-admin-test' },
  };
}

const createInput = {
  code: 'GARDEN25',
  discountPercent: 25,
  minItemCount: 2,
  kind: 'percent' as const,
  amountCents: null,
  minSubtotalCents: 5000,
  categoryScope: 'Garden & Outdoors',
  startAt: '2026-08-01T00:00:00.000Z',
  endAt: '2026-09-01T00:00:00.000Z',
  maxRedemptions: 10,
  perUserLimit: 2,
};

void test('promo admin creates, updates, deactivates, and audits each committed mutation once', (t) => {
  const { db, service, context } = fixture(t);
  const created = service.create(createInput, context);
  assert.deepEqual(created, { ...createInput, active: true, redemptionCount: 0 });
  assert.deepEqual(
    service.listAdmin({ active: true }).map((promo) => promo.code),
    ['GARDEN25'],
  );

  const updated = service.update(
    'GARDEN25',
    { ...createInput, kind: 'fixed', discountPercent: 0, amountCents: 1250 },
    context,
  );
  assert.equal(updated.kind, 'fixed');
  assert.equal(updated.amountCents, 1250);

  const deactivated = service.deactivate('GARDEN25', context);
  assert.equal(deactivated.active, false);
  assert.deepEqual(
    db
      .prepare(
        "SELECT action, entity_type, entity_id FROM audit_events WHERE entity_id = 'GARDEN25'",
      )
      .all(),
    [
      { action: 'promo.created', entity_type: 'promo', entity_id: 'GARDEN25' },
      { action: 'promo.updated', entity_type: 'promo', entity_id: 'GARDEN25' },
      { action: 'promo.deactivated', entity_type: 'promo', entity_id: 'GARDEN25' },
    ],
  );
});

void test('promo admin rejects invalid promotion fields without recording audit rows', (t) => {
  const { db, service, context } = fixture(t);
  for (const input of [
    { ...createInput, categoryScope: 'Unknown category' },
    { ...createInput, kind: 'percent' as const, discountPercent: 0 },
    { ...createInput, kind: 'fixed' as const, discountPercent: 0, amountCents: null },
    { ...createInput, startAt: '2026-09-01T00:00:00.000Z', endAt: '2026-08-01T00:00:00.000Z' },
    { ...createInput, perUserLimit: 0 },
  ]) {
    assert.throws(() => service.create(input, context), PromoAdminServiceError);
  }
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM promo_codes').get() as { count: number }).count,
    0,
  );
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM audit_events').get() as { count: number }).count,
    0,
  );
});

void test('promo admin protects redemption counts and requires force for active reservations', (t) => {
  const { db, service, context } = fixture(t);
  service.create(createInput, context);
  db.prepare('UPDATE promo_codes SET redemption_count = 4 WHERE code = ?').run('GARDEN25');
  assert.throws(
    () => service.update('GARDEN25', { ...createInput, maxRedemptions: 3 }, context),
    /maxRedemptions must be at least the current redemption count/,
  );
  db.prepare(
    `INSERT INTO payments
      (idempotency_key, request_fingerprint, status, amount_cents, card_last4, card_brand)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('promo-admin-reservation', 'promo-admin-fingerprint', 'pending', 0, '0000', 'test');
  db.prepare(
    `INSERT INTO promo_reservations (promo_code, user_id, payment_idempotency_key, created_at)
     VALUES (?, NULL, ?, ?)`,
  ).run('GARDEN25', 'promo-admin-reservation', '2026-07-29T10:00:00.000Z');
  assert.throws(() => service.deactivate('GARDEN25', context), /active reservations/);
  assert.equal(service.deactivate('GARDEN25', context, { force: true }).active, false);
  assert.equal(
    (
      db
        .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'promo.deactivated'")
        .get() as {
        count: number;
      }
    ).count,
    1,
  );
});

void test('promo admin cannot reduce max redemptions below committed and held usage', (t) => {
  const { db, service, context } = fixture(t);
  service.create(createInput, context);
  db.prepare('UPDATE promo_codes SET redemption_count = 3 WHERE code = ?').run('GARDEN25');
  const insertPayment = db.prepare(
    `INSERT INTO payments
      (idempotency_key, request_fingerprint, status, amount_cents, card_last4, card_brand)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insertReservation = db.prepare(
    `INSERT INTO promo_reservations (promo_code, user_id, payment_idempotency_key, created_at)
     VALUES (?, NULL, ?, ?)`,
  );
  for (const idempotencyKey of ['promo-admin-held-1', 'promo-admin-held-2']) {
    insertPayment.run(
      idempotencyKey,
      `${idempotencyKey}-fingerprint`,
      'pending',
      0,
      '0000',
      'test',
    );
    insertReservation.run('GARDEN25', idempotencyKey, '2026-07-29T10:00:00.000Z');
  }

  assert.equal(
    (
      db
        .prepare('SELECT COUNT(*) AS count FROM promo_reservations WHERE promo_code = ?')
        .get('GARDEN25') as {
        count: number;
      }
    ).count,
    2,
  );
  assert.throws(
    () => service.update('GARDEN25', { ...createInput, maxRedemptions: 4 }, context),
    /maxRedemptions must be at least the current redemption count plus active reservations/,
  );
  assert.equal(service.get('GARDEN25').maxRedemptions, 10);
  assert.equal(
    (
      db
        .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'promo.updated'")
        .get() as { count: number }
    ).count,
    0,
  );
});

void test('promo admin persists and replaces country targeting sets', (t) => {
  const { db, service, context } = fixture(t);
  const created = service.create({ ...createInput, countries: ['UK', 'US'] }, context);
  assert.deepEqual(created.countries, ['UK', 'US']);
  assert.deepEqual(
    db
      .prepare(
        `SELECT pcc.country
         FROM promo_code_countries pcc
         JOIN promo_codes pc ON pc.id = pcc.promo_code_id
         WHERE pc.code = ? ORDER BY pcc.rowid`,
      )
      .all('GARDEN25'),
    [{ country: 'UK' }, { country: 'US' }],
  );

  const updated = service.update('GARDEN25', { ...createInput, countries: ['DE'] }, context);
  assert.deepEqual(updated.countries, ['DE']);
  assert.deepEqual(
    db
      .prepare(
        `SELECT pcc.country
         FROM promo_code_countries pcc
         JOIN promo_codes pc ON pc.id = pcc.promo_code_id
         WHERE pc.code = ? ORDER BY pcc.rowid`,
      )
      .all('GARDEN25'),
    [{ country: 'DE' }],
  );
});

void test('promo admin rejects duplicate and unknown country targeting values', (t) => {
  const { db, service, context } = fixture(t);
  assert.throws(
    () => service.create({ ...createInput, countries: ['UK', 'UK'] }, context),
    (error: unknown) => error instanceof PromoAdminServiceError && error.code === 'INVALID_INPUT',
  );
  assert.throws(
    () => service.create({ ...createInput, countries: ['ZZ' as never] }, context),
    (error: unknown) => error instanceof PromoAdminServiceError && error.code === 'INVALID_INPUT',
  );
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM promo_codes').get() as { count: number }).count,
    0,
  );
});
