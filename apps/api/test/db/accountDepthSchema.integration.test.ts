import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { closeDatabase, migrateDatabase } from '../../src/db/index.js';
import { migrations } from '../../src/db/migrations/index.js';

function columnNames(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (column) => column.name,
  );
}

function indexNames(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA index_list(${table})`).all() as { name: string }[]).map(
    (index) => index.name,
  );
}

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
  );
}

void test('account-depth migrations add self-service and company schema with enforced invariants', () => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-account-depth-schema-'));
  const db = new Database(join(directory, 'shop.db'));
  db.pragma('foreign_keys = ON');

  try {
    migrateDatabase(
      db,
      migrations.filter((migration) => migration.version < '025'),
    );
    db.exec(`
      INSERT INTO users (id, email, display_name, password_hash, password_salt, role)
      VALUES
        (2501, 'account-depth-owner@example.test', 'Account depth owner', 'hash', 'salt', 'customer'),
        (2502, 'account-depth-buyer@example.test', 'Account depth buyer', 'hash', 'salt', 'customer');
      INSERT INTO sessions (token, user_id, created_at, expires_at)
      VALUES ('legacy-session', 2501, '2026-07-01T09:00:00.000Z', '2026-08-01T09:00:00.000Z');
    `);

    migrateDatabase(db);

    assert.deepEqual(
      migrations
        .map((migration) => migration.version)
        .filter((version) => version === '025' || version === '026'),
      ['025', '026'],
    );
    for (const table of [
      'user_preferences',
      'account_deletion_events',
      'company_accounts',
      'company_memberships',
      'company_invites',
      'order_approvals',
    ]) {
      assert.equal(tableExists(db, table), true, `${table} must exist`);
    }

    for (const column of ['user_agent', 'ip_address_hash', 'last_seen_at']) {
      assert.ok(columnNames(db, 'sessions').includes(column), `sessions.${column}`);
    }
    assert.deepEqual(
      db.prepare("SELECT last_seen_at FROM sessions WHERE token = 'legacy-session'").get(),
      { last_seen_at: '2026-07-01T09:00:00.000Z' },
    );
    for (const column of [
      'user_id',
      'order_updates_email',
      'marketing_email',
      'approval_request_email',
      'updated_at',
    ]) {
      assert.ok(columnNames(db, 'user_preferences').includes(column), `user_preferences.${column}`);
    }
    for (const column of [
      'id',
      'user_id',
      'requested_at',
      'completed_at',
      'tombstone_email',
      'tombstone_display_name',
    ]) {
      assert.ok(
        columnNames(db, 'account_deletion_events').includes(column),
        `account_deletion_events.${column}`,
      );
    }

    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO user_preferences
              (user_id, order_updates_email, marketing_email, approval_request_email)
             VALUES (2501, 2, 0, 1)`,
          )
          .run(),
      /CHECK constraint failed/,
    );
    db.prepare(
      `INSERT INTO user_preferences
        (user_id, order_updates_email, marketing_email, approval_request_email)
       VALUES (2501, 1, 0, 1)`,
    ).run();
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO user_preferences
              (user_id, order_updates_email, marketing_email, approval_request_email)
             VALUES (2501, 1, 0, 1)`,
          )
          .run(),
      /UNIQUE constraint failed/,
    );

    for (const column of [
      'id',
      'name',
      'created_by_user_id',
      'active',
      'approval_threshold_cents',
      'created_at',
      'updated_at',
    ]) {
      assert.ok(columnNames(db, 'company_accounts').includes(column), `company_accounts.${column}`);
    }
    for (const column of ['company_id', 'user_id', 'role', 'active', 'created_at']) {
      assert.ok(
        columnNames(db, 'company_memberships').includes(column),
        `company_memberships.${column}`,
      );
    }
    for (const column of [
      'company_id',
      'email',
      'role',
      'token_digest',
      'status',
      'expires_at',
      'created_at',
      'resolved_at',
    ]) {
      assert.ok(columnNames(db, 'company_invites').includes(column), `company_invites.${column}`);
    }
    for (const column of [
      'company_id',
      'requested_by_user_id',
      'cart_id',
      'idempotency_key',
      'quote_total_cents',
      'delivery_site_id',
      'delivery_address_json',
      'billing_entity_json',
      'delivery_slot_date',
      'delivery_slot_window',
      'purchase_order_reference',
      'status',
      'approved_by_user_id',
      'decision_reason',
      'requested_at',
      'resolved_at',
      'lease_expires_at',
    ]) {
      assert.ok(columnNames(db, 'order_approvals').includes(column), `order_approvals.${column}`);
    }
    for (const [table, indexes] of [
      [
        'company_memberships',
        [
          'company_memberships_company_user_active_idx',
          'company_memberships_company_owner_active_idx',
          'company_memberships_user_active_idx',
        ],
      ],
      ['company_invites', ['company_invites_company_email_pending_idx']],
      [
        'order_approvals',
        ['order_approvals_company_status_idx', 'order_approvals_idempotency_key_idx'],
      ],
    ] as const) {
      for (const index of indexes) {
        assert.ok(indexNames(db, table).includes(index), `${index} must exist`);
      }
    }

    db.prepare(
      `INSERT INTO company_accounts
        (id, name, created_by_user_id, approval_threshold_cents, created_at, updated_at)
       VALUES (2601, 'Account Depth Materials Ltd', 2501, 0,
               '2026-07-01T09:00:00.000Z', '2026-07-01T09:00:00.000Z')`,
    ).run();
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO company_accounts
              (name, created_by_user_id, approval_threshold_cents, created_at, updated_at)
             VALUES ('Invalid company', 2501, -1, '2026-07-01', '2026-07-01')`,
          )
          .run(),
      /CHECK constraint failed/,
    );
    const insertMembership = db.prepare(
      `INSERT INTO company_memberships (company_id, user_id, role, active, created_at)
       VALUES (?, ?, ?, ?, '2026-07-01T09:00:00.000Z')`,
    );
    insertMembership.run(2601, 2501, 'owner', 1);
    assert.throws(() => insertMembership.run(2601, 2502, 'owner', 1), /UNIQUE constraint failed/);
    assert.throws(() => insertMembership.run(2601, 2501, 'buyer', 1), /UNIQUE constraint failed/);
    insertMembership.run(2601, 2502, 'buyer', 1);
    assert.throws(
      () => insertMembership.run(2601, 2502, 'invalid-role', 0),
      /CHECK constraint failed/,
    );

    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO company_invites
              (company_id, email, role, token_digest, status, expires_at, created_at)
             VALUES (2601, 'invitee@example.test', 'owner', 'digest-owner', 'pending',
                     '2026-08-01T09:00:00.000Z', '2026-07-01T09:00:00.000Z')`,
          )
          .run(),
      /CHECK constraint failed/,
    );
    db.prepare(
      `INSERT INTO company_invites
        (company_id, email, role, token_digest, status, expires_at, created_at)
       VALUES (2601, 'invitee@example.test', 'buyer', 'digest-buyer', 'pending',
               '2026-08-01T09:00:00.000Z', '2026-07-01T09:00:00.000Z')`,
    ).run();
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO company_invites
              (company_id, email, role, token_digest, status, expires_at, created_at)
             VALUES (2601, 'invitee@example.test', 'approver', 'digest-approver', 'pending',
                     '2026-08-01T09:00:00.000Z', '2026-07-01T09:00:00.000Z')`,
          )
          .run(),
      /UNIQUE constraint failed/,
    );

    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO order_approvals
              (company_id, requested_by_user_id, cart_id, idempotency_key, quote_total_cents,
               delivery_address_json, billing_entity_json, delivery_slot_date, delivery_slot_window,
               requested_at, lease_expires_at)
             VALUES (2601, 2502, 'cart-2601', 'approval-2601', 5000, '{}', '{}', '2026-08-01',
                     'evening', '2026-07-01T09:00:00.000Z', '2026-07-02T09:00:00.000Z')`,
          )
          .run(),
      /CHECK constraint failed/,
    );
    db.prepare(
      `INSERT INTO order_approvals
        (company_id, requested_by_user_id, cart_id, idempotency_key, quote_total_cents,
         delivery_address_json, billing_entity_json, delivery_slot_date, delivery_slot_window,
         requested_at, lease_expires_at)
       VALUES (2601, 2502, 'cart-2601', 'approval-2601', 5000, '{}', '{}', '2026-08-01', 'am',
               '2026-07-01T09:00:00.000Z', '2026-07-02T09:00:00.000Z')`,
    ).run();
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO order_approvals
              (company_id, requested_by_user_id, cart_id, idempotency_key, quote_total_cents,
               delivery_address_json, billing_entity_json, delivery_slot_date, delivery_slot_window,
               requested_at, lease_expires_at)
             VALUES (2601, 2502, 'cart-2602', 'approval-2601', 5000, '{}', '{}', '2026-08-01', 'pm',
                     '2026-07-01T09:00:00.000Z', '2026-07-02T09:00:00.000Z')`,
          )
          .run(),
      /UNIQUE constraint failed/,
    );
    assert.equal((db.pragma('foreign_key_check') as unknown[]).length, 0);
  } finally {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  }
});
