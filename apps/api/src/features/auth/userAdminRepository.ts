import type Database from 'better-sqlite3';
import type { PublicUser } from '@shop/contracts/auth';
import type { Country } from '@shop/contracts/country';

export interface AdminUserRecord {
  id: number;
  email: string;
  displayName: string;
  role: PublicUser['role'];
  country: string;
  suspendedAt: string | null;
  suspensionReason: string | null;
  suspendedByUserId: number | null;
}

interface AdminUserRow {
  id: number;
  email: string;
  display_name: string;
  role: PublicUser['role'];
  country: string;
  suspended_at: string | null;
  suspension_reason: string | null;
  suspended_by_user_id: number | null;
}

export interface UserAdminRepository {
  list(query?: { search?: string }, country?: Country): AdminUserRecord[];
  get(userId: number, country?: Country): AdminUserRecord | undefined;
  updateDisplayName(userId: number, displayName: string): AdminUserRecord | undefined;
  setRole(userId: number, role: PublicUser['role']): AdminUserRecord | undefined;
  suspend(input: {
    userId: number;
    reason: string;
    suspendedAt: string;
    suspendedByUserId: number;
  }): AdminUserRecord | undefined;
  reactivate(userId: number): AdminUserRecord | undefined;
  countActiveAdmins(): number;
}

function toRecord(row: AdminUserRow): AdminUserRecord {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    country: row.country,
    suspendedAt: row.suspended_at,
    suspensionReason: row.suspension_reason,
    suspendedByUserId: row.suspended_by_user_id,
  };
}

export function createUserAdminRepository(db: Database.Database): UserAdminRepository {
  const select = `SELECT id, email, display_name, role, country, suspended_at, suspension_reason,
    suspended_by_user_id FROM users`;
  const get = (userId: number, country?: Country): AdminUserRecord | undefined => {
    const row = db
      .prepare(`${select} WHERE id = ?${country ? ' AND country = ?' : ''}`)
      .get(...(country ? [userId, country] : [userId])) as AdminUserRow | undefined;
    return row ? toRecord(row) : undefined;
  };

  return {
    list(query = {}, country) {
      const search = query.search?.trim();
      const predicates: string[] = [];
      if (search)
        predicates.push('(email LIKE ? COLLATE NOCASE OR display_name LIKE ? COLLATE NOCASE)');
      if (country) predicates.push('country = ?');
      const where = predicates.length ? ` WHERE ${predicates.join(' AND ')}` : '';
      const values = search ? [`%${search}%`, `%${search}%`] : [];
      if (country) values.push(country);
      return db
        .prepare(`${select}${where} ORDER BY id ASC`)
        .all(...values)
        .map((row) => toRecord(row as AdminUserRow));
    },
    get,
    updateDisplayName(userId, displayName) {
      const result = db
        .prepare('UPDATE users SET display_name = ? WHERE id = ?')
        .run(displayName, userId);
      return result.changes === 1 ? get(userId) : undefined;
    },
    setRole(userId, role) {
      const result = db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
      return result.changes === 1 ? get(userId) : undefined;
    },
    suspend({ userId, reason, suspendedAt, suspendedByUserId }) {
      const result = db
        .prepare(
          `UPDATE users
           SET suspended_at = ?, suspension_reason = ?, suspended_by_user_id = ?
           WHERE id = ?`,
        )
        .run(suspendedAt, reason, suspendedByUserId, userId);
      return result.changes === 1 ? get(userId) : undefined;
    },
    reactivate(userId) {
      const result = db
        .prepare(
          `UPDATE users
           SET suspended_at = NULL, suspension_reason = NULL, suspended_by_user_id = NULL
           WHERE id = ?`,
        )
        .run(userId);
      return result.changes === 1 ? get(userId) : undefined;
    },
    countActiveAdmins() {
      return (
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND suspended_at IS NULL",
          )
          .get() as { count: number }
      ).count;
    },
  };
}
