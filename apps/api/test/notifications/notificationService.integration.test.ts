import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { migrateDatabase } from '../../src/db/migrate.js';
import { createUnitOfWork } from '../../src/db/unitOfWork.js';
import { createAuditWriter } from '../../src/features/audit/auditService.js';
import { createAuditRepository } from '../../src/features/audit/auditRepository.js';
import { JobHandlerRegistry } from '../../src/features/jobs/jobHandlerRegistry.js';
import { createJobRepository } from '../../src/features/jobs/jobRepository.js';
import { JobService } from '../../src/features/jobs/jobService.js';
import { createMailboxRepository } from '../../src/features/mailbox/mailboxRepository.js';
import { createNotificationDeliveryHandler } from '../../src/features/notifications/notificationDeliveryHandler.js';
import { createNotificationRepository } from '../../src/features/notifications/notificationRepository.js';
import { createNotificationService } from '../../src/features/notifications/notificationService.js';
import { createPreferencesRepository } from '../../src/features/preferences/preferencesRepository.js';
import { createPreferencesService } from '../../src/features/preferences/preferencesService.js';
import { noFaults } from '../../src/features/jobs/faultSwitch.js';
import { paymentSettledCopy } from '@shop/localisation/messages/asyncContent';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'shop-notifications-'));
  const db = new Database(join(dir, 'shop.db'));
  migrateDatabase(db);
  const clock = { now: () => new Date('2026-08-01T00:00:00.000Z') };
  const uow = createUnitOfWork(db);
  const audit = createAuditWriter({ repository: createAuditRepository(db), clock });
  const preferences = createPreferencesService({
    repository: createPreferencesRepository(db),
    unitOfWork: uow,
    audit,
    clock,
  });
  const registry = new JobHandlerRegistry();
  const jobs = new JobService({
    repository: createJobRepository(db),
    registry,
    unitOfWork: uow,
    clock,
  });
  const repository = createNotificationRepository(db);
  const mailbox = createMailboxRepository(db);
  const service = createNotificationService({ repository, jobs, unitOfWork: uow, audit, clock });
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
  registry.register(
    'notification.deliver',
    createNotificationDeliveryHandler({
      repository,
      preferences,
      mailbox,
      audit,
      clock,
      faults: noFaults,
    }),
  );
  return {
    db,
    jobs,
    mailbox,
    preferences,
    service,
    addUser,
    close: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const system = { actor: { type: 'system' as const, userId: null }, requestId: null };

void test('deduplicates notification persistence and queueing, while respecting preference defaults and opt-outs', async () => {
  const f = fixture();
  try {
    const buyer = f.addUser('buyer@example.test');
    const first = f.service.notify({
      userId: buyer,
      kind: 'order.placed',
      title: 'Order received',
      body: 'Your order is received.',
      entityType: 'order',
      entityId: '1',
      context: system,
    });
    const replay = f.service.notify({
      userId: buyer,
      kind: 'order.placed',
      title: 'Ignored',
      body: 'Ignored',
      entityType: 'order',
      entityId: '1',
      context: system,
    });
    assert.equal(first.created, true);
    assert.equal(replay.created, false);
    assert.equal(
      (f.db.prepare('SELECT COUNT(*) AS count FROM notifications').get() as { count: number })
        .count,
      1,
    );
    assert.equal(
      (f.db.prepare('SELECT COUNT(*) AS count FROM jobs').get() as { count: number }).count,
      1,
    );
    const secondBuyer = f.addUser('second-buyer@example.test');
    const secondBuyerNotification = f.service.notify({
      userId: secondBuyer,
      kind: 'order.placed',
      title: 'Order received',
      body: 'Your order is received.',
      entityType: 'order',
      entityId: '1',
      context: system,
    });
    assert.equal(secondBuyerNotification.created, true);
    assert.equal(f.service.list(secondBuyer).total, 1);
    assert.equal(
      (f.db.prepare('SELECT COUNT(*) AS count FROM notifications').get() as { count: number })
        .count,
      2,
    );
    assert.equal(
      (f.db.prepare('SELECT COUNT(*) AS count FROM jobs').get() as { count: number }).count,
      2,
    );
    await f.jobs.runDue();
    assert.equal(f.mailbox.list().length, 2, 'no saved preferences use default delivery');

    f.preferences.update(
      buyer,
      { orderUpdatesEmail: false },
      { actor: { type: 'user', userId: buyer }, requestId: 'notification-preference-test' },
    );
    f.service.notify({
      userId: buyer,
      kind: 'order.shipped',
      title: 'Order shipped',
      body: 'Your order shipped.',
      entityType: 'order',
      entityId: '2',
      context: system,
    });
    await f.jobs.runDue();
    assert.equal(f.mailbox.list().length, 2, 'in-app rows remain when email delivery is skipped');
  } finally {
    f.close();
  }
});

void test('owner-scoped reads are idempotent and cannot be accessed by another buyer', () => {
  const f = fixture();
  try {
    const owner = f.addUser('owner@example.test');
    const other = f.addUser('other@example.test');
    const item = f.service.notify({
      userId: owner,
      kind: 'standing_order.run_completed',
      title: 'Standing order complete',
      body: 'Completed.',
      entityType: 'standing_order',
      entityId: '3',
      context: system,
    }).notification;
    assert.equal(f.service.list(other).total, 0);
    assert.deepEqual(f.service.markRead(owner, 999_999, system), {
      ok: false,
      code: 'NOT_FOUND',
    });
    assert.deepEqual(f.service.markRead(other, Number(item.id), system), {
      ok: false,
      code: 'FORBIDDEN',
    });
    assert.equal(f.service.markRead(owner, Number(item.id), system).ok, true);
    assert.equal(f.service.markRead(owner, Number(item.id), system).ok, true);
    assert.deepEqual(f.service.markAllRead(owner, system), { affectedCount: 0 });
  } finally {
    f.close();
  }
});

void test('notification delivery retains translated DE and FR snapshots', async () => {
  const f = fixture();
  try {
    const de = f.addUser('notification-de@example.test', 'DE');
    const fr = f.addUser('notification-fr@example.test', 'FR');
    const deCopy = paymentSettledCopy('DE', 41);
    const frCopy = paymentSettledCopy('FR', 42);
    f.service.notify({
      userId: de,
      kind: 'payment.webhook_settled',
      title: deCopy.title,
      body: deCopy.body,
      entityType: 'order',
      entityId: '41',
      context: system,
    });
    f.service.notify({
      userId: fr,
      kind: 'payment.webhook_settled',
      title: frCopy.title,
      body: frCopy.body,
      entityType: 'order',
      entityId: '42',
      context: system,
    });
    await f.jobs.runDue();

    assert.deepEqual(
      f.db
        .prepare(
          `SELECT user_id, title, body FROM notifications
           WHERE user_id IN (?, ?) ORDER BY user_id`,
        )
        .all(de, fr),
      [
        {
          user_id: de,
          title: 'Zahlungsaktualisierung erhalten',
          body: 'Zahlungsaktualisierung f\u00fcr Bestellung Nr. 41 erhalten.',
        },
        {
          user_id: fr,
          title: 'Mise \u00e0 jour du paiement re\u00e7ue',
          body: 'Mise \u00e0 jour du paiement re\u00e7ue pour la commande n\u00b0 42.',
        },
      ],
    );
    assert.deepEqual(
      f.db
        .prepare(
          `SELECT recipient, subject, body, kind FROM dev_mailbox
           WHERE recipient IN (?, ?) ORDER BY recipient`,
        )
        .all('notification-de@example.test', 'notification-fr@example.test'),
      [
        {
          recipient: 'notification-de@example.test',
          subject: 'Zahlungsaktualisierung erhalten',
          body: 'Zahlungsaktualisierung f\u00fcr Bestellung Nr. 41 erhalten.',
          kind: 'notification',
        },
        {
          recipient: 'notification-fr@example.test',
          subject: 'Mise \u00e0 jour du paiement re\u00e7ue',
          body: 'Mise \u00e0 jour du paiement re\u00e7ue pour la commande n\u00b0 42.',
          kind: 'notification',
        },
      ],
    );
  } finally {
    f.close();
  }
});
