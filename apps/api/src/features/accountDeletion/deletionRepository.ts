import type Database from 'better-sqlite3';

export interface AccountDeletionRepository {
  /** True when removing the user would leave an active company with other active members. */
  ownsCompanyWithOtherMembers(userId: number): boolean;
  /** Retires companies for which this user is the sole active owner/member. */
  retireSoleOwnedCompanies(userId: number, now: string): void;
  retireTradeRecords(userId: number, now: string): void;
  retireMemberships(userId: number): void;
  deleteLiveAccountRecords(userId: number): void;
  redactUser(userId: number, tombstoneEmail: string, tombstoneDisplayName: string): void;
  recordDeletion(input: {
    userId: number;
    requestedAt: string;
    completedAt: string;
    tombstoneEmail: string;
    tombstoneDisplayName: string;
  }): void;
}

/**
 * Owns the destructive, user-scoped SQL for self deletion. Historic commerce tables are
 * deliberately absent: redaction retains their user foreign keys and their snapshots intact.
 */
export function createAccountDeletionRepository(db: Database.Database): AccountDeletionRepository {
  return {
    ownsCompanyWithOtherMembers(userId) {
      return (
        db
          .prepare(
            `SELECT 1
             FROM company_memberships owner
             JOIN company_accounts company ON company.id = owner.company_id
             WHERE owner.user_id = ? AND owner.role = 'owner' AND owner.active = 1
               AND company.active = 1
               AND EXISTS (
                 SELECT 1 FROM company_memberships member
                 WHERE member.company_id = owner.company_id
                   AND member.active = 1
                   AND member.user_id != ?
               )
             LIMIT 1`,
          )
          .get(userId, userId) !== undefined
      );
    },
    retireSoleOwnedCompanies(userId, now) {
      db.prepare(
        `UPDATE company_accounts
         SET active = 0, updated_at = ?
         WHERE active = 1
           AND EXISTS (
             SELECT 1 FROM company_memberships owner
             WHERE owner.company_id = company_accounts.id
               AND owner.user_id = ? AND owner.role = 'owner' AND owner.active = 1
           )
           AND NOT EXISTS (
             SELECT 1 FROM company_memberships member
             WHERE member.company_id = company_accounts.id
               AND member.active = 1 AND member.user_id != ?
           )`,
      ).run(now, userId, userId);
    },
    retireTradeRecords(userId, now) {
      db.prepare(
        `UPDATE delivery_sites
         SET active = 0, is_default = 0, updated_at = ?
         WHERE user_id = ? AND active = 1`,
      ).run(now, userId);
      db.prepare(
        `UPDATE billing_entities
         SET active = 0, is_default = 0, updated_at = ?
         WHERE user_id = ? AND active = 1`,
      ).run(now, userId);
    },
    retireMemberships(userId) {
      db.prepare('UPDATE company_memberships SET active = 0 WHERE user_id = ? AND active = 1').run(
        userId,
      );
    },
    deleteLiveAccountRecords(userId) {
      // Carts are bearer-scoped rather than user-keyed. A user-created cart is the only durable
      // ownership evidence available without widening the cart contract, so cleanup is limited
      // to configured lines in carts whose immutable creation event names this user. Plain cart
      // lines remain available to the browser, and no cart created by another user is mutated.
      db.prepare(
        `DELETE FROM cart_line_items
         WHERE custom_blend_json IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM audit_events created
             WHERE created.action = 'cart.created'
               AND created.entity_type = 'cart'
               AND created.actor_type = 'user'
               AND created.actor_user_id = ?
               AND created.entity_id = cart_line_items.cart_id
           )`,
      ).run(userId);
      db.prepare('DELETE FROM user_preferences WHERE user_id = ?').run(userId);
      db.prepare(
        `DELETE FROM saved_list_items
         WHERE saved_list_id IN (SELECT id FROM saved_lists WHERE user_id = ?)`,
      ).run(userId);
      db.prepare('DELETE FROM saved_lists WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    },
    redactUser(userId, tombstoneEmail, tombstoneDisplayName) {
      db.prepare(
        `UPDATE users
         SET email = ?, display_name = ?, password_hash = '', password_salt = ''
         WHERE id = ?`,
      ).run(tombstoneEmail, tombstoneDisplayName, userId);
    },
    recordDeletion({ userId, requestedAt, completedAt, tombstoneEmail, tombstoneDisplayName }) {
      db.prepare(
        `INSERT INTO account_deletion_events
          (user_id, requested_at, completed_at, tombstone_email, tombstone_display_name)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(userId, requestedAt, completedAt, tombstoneEmail, tombstoneDisplayName);
    },
  };
}
