import type Database from 'better-sqlite3';
import type { UpdatePreferencesBody, UserPreferences } from '@shop/contracts/account-depth';

/** Persistence shape owned by the preferences repository. */
export interface UserPreferencesRow {
  user_id: number;
  order_updates_email: number;
  marketing_email: number;
  approval_request_email: number;
  updated_at: string;
}

export interface PreferencesRepository {
  get(userId: number): UserPreferencesRow | undefined;
  upsert(userId: number, patch: UpdatePreferencesBody, updatedAt: string): UserPreferencesRow;
}

/** Maps SQLite's checked 0|1 flags to the public preference shape. */
export function toUserPreferences(row: UserPreferencesRow): UserPreferences {
  return {
    orderUpdatesEmail: row.order_updates_email === 1,
    marketingEmail: row.marketing_email === 1,
    approvalRequestEmail: row.approval_request_email === 1,
  };
}

function toSqlBoolean(value: boolean | undefined): number | null {
  if (value === undefined) return null;
  return value ? 1 : 0;
}

export function createPreferencesRepository(db: Database.Database): PreferencesRepository {
  return {
    get(userId) {
      return db
        .prepare(
          `SELECT user_id, order_updates_email, marketing_email, approval_request_email, updated_at
           FROM user_preferences WHERE user_id = ?`,
        )
        .get(userId) as UserPreferencesRow | undefined;
    },
    upsert(userId, patch, updatedAt) {
      const orderUpdatesEmail = toSqlBoolean(patch.orderUpdatesEmail);
      const marketingEmail = toSqlBoolean(patch.marketingEmail);
      const approvalRequestEmail = toSqlBoolean(patch.approvalRequestEmail);
      return db
        .prepare(
          `INSERT INTO user_preferences (
             user_id, order_updates_email, marketing_email, approval_request_email, updated_at
           ) VALUES (?, COALESCE(?, 1), COALESCE(?, 0), COALESCE(?, 1), ?)
           ON CONFLICT(user_id) DO UPDATE SET
             order_updates_email = COALESCE(?, user_preferences.order_updates_email),
             marketing_email = COALESCE(?, user_preferences.marketing_email),
             approval_request_email = COALESCE(?, user_preferences.approval_request_email),
             updated_at = excluded.updated_at
           RETURNING user_id, order_updates_email, marketing_email, approval_request_email, updated_at`,
        )
        .get(
          userId,
          orderUpdatesEmail,
          marketingEmail,
          approvalRequestEmail,
          updatedAt,
          orderUpdatesEmail,
          marketingEmail,
          approvalRequestEmail,
        ) as UserPreferencesRow;
    },
  };
}
