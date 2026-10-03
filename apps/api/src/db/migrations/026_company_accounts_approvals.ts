import type { Migration } from '../migrate.js';

type MigrationDb = Parameters<Migration['up']>[0];

function assertForeignKeysClean(db: MigrationDb): void {
  const violations = db.pragma('foreign_key_check') as unknown[];
  if (violations.length > 0) {
    throw new Error(`Foreign key violations after migration 026: ${JSON.stringify(violations)}`);
  }
}

/**
 * Adds company membership and approval-request records. Company accounts and memberships are
 * retired through `active`, so historic approval snapshots retain their valid references.
 */
export const companyAccountsApprovalsMigration: Migration = {
  version: '026',
  name: 'company accounts and approvals',
  up(db) {
    // The migration runner owns FK suspension for this transaction. Do not toggle it here.
    db.exec(`
      CREATE TABLE IF NOT EXISTS company_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
        created_by_user_id INTEGER NOT NULL REFERENCES users(id),
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        approval_threshold_cents INTEGER CHECK (
          approval_threshold_cents IS NULL OR approval_threshold_cents >= 0
        ),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS company_memberships (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL REFERENCES company_accounts(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        role TEXT NOT NULL CHECK (role IN ('owner', 'buyer', 'approver')),
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS company_memberships_company_user_active_idx
        ON company_memberships(company_id, user_id) WHERE active = 1;

      CREATE UNIQUE INDEX IF NOT EXISTS company_memberships_company_owner_active_idx
        ON company_memberships(company_id) WHERE role = 'owner' AND active = 1;

      CREATE UNIQUE INDEX IF NOT EXISTS company_memberships_user_active_idx
        ON company_memberships(user_id) WHERE active = 1;

      CREATE TABLE IF NOT EXISTS company_invites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL REFERENCES company_accounts(id),
        email TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('buyer', 'approver')),
        token_digest TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS company_invites_company_email_pending_idx
        ON company_invites(company_id, email) WHERE status = 'pending';

      CREATE TABLE IF NOT EXISTS order_approvals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL REFERENCES company_accounts(id),
        requested_by_user_id INTEGER NOT NULL REFERENCES users(id),
        cart_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        quote_total_cents INTEGER NOT NULL,
        delivery_site_id INTEGER REFERENCES delivery_sites(id),
        delivery_address_json TEXT NOT NULL,
        billing_entity_json TEXT NOT NULL,
        delivery_slot_date TEXT NOT NULL,
        delivery_slot_window TEXT NOT NULL CHECK (delivery_slot_window IN ('am', 'pm')),
        purchase_order_reference TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
        approved_by_user_id INTEGER REFERENCES users(id),
        decision_reason TEXT,
        requested_at TEXT NOT NULL,
        resolved_at TEXT,
        lease_expires_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS order_approvals_company_status_idx
        ON order_approvals(company_id, status);

      CREATE INDEX IF NOT EXISTS order_approvals_idempotency_key_idx
        ON order_approvals(idempotency_key);
    `);

    assertForeignKeysClean(db);
  },
};
