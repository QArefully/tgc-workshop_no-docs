import type Database from 'better-sqlite3';
import type { PublicUser } from '@shop/contracts/auth';

export interface SessionUser {
  id: number;
  email: string;
  displayName: string;
  role: PublicUser['role'];
  country: string;
}

export interface SessionRecord {
  token: string;
  userId: number;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string | null;
  userAgent: string | null;
  ipAddressHash: string | null;
}

interface SessionRow {
  token: string;
  user_id: number;
  created_at: string;
  expires_at: string;
  last_seen_at: string | null;
  user_agent: string | null;
  ip_address_hash: string | null;
  email?: string;
  display_name?: string;
  role?: PublicUser['role'];
  country?: string;
}

export interface SessionRepository {
  create(session: SessionRecord): boolean;
  findUser(token: string): (SessionRecord & { user: SessionUser }) | null;
  listByUser(userId: number): SessionRecord[];
  findByShortId(sessionShortId: string): SessionRecord | null;
  delete(token: string): boolean;
  deleteByIdForUser(userId: number, sessionShortId: string): boolean;
  deleteForUser(userId: number): number;
  deleteOtherForUser(userId: number, token: string): number;
  updateLastSeen(token: string, now: string, staleBefore: string): boolean;
}

function toRecord(row: SessionRow): SessionRecord {
  return {
    token: row.token,
    userId: row.user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
    userAgent: row.user_agent,
    ipAddressHash: row.ip_address_hash,
  };
}

export function createSessionRepository(db: Database.Database): SessionRepository {
  return {
    create({ token, userId, createdAt, expiresAt, lastSeenAt, userAgent, ipAddressHash }) {
      // Guarded insert, not a read-then-write: a suspension landing between the check and the
      // insert must lose, so the live-user test happens inside the same statement.
      return (
        db
          .prepare(
            `INSERT INTO sessions
              (token, user_id, created_at, expires_at, last_seen_at, user_agent, ip_address_hash)
             SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (
               SELECT 1 FROM users WHERE id = ? AND suspended_at IS NULL
             )`,
          )
          .run(token, userId, createdAt, expiresAt, lastSeenAt, userAgent, ipAddressHash, userId)
          .changes === 1
      );
    },
    findUser(token) {
      const row = db
        .prepare(
          `SELECT s.token, s.user_id, s.created_at, s.expires_at, s.last_seen_at, s.user_agent,
                  s.ip_address_hash, u.email, u.display_name, u.role, u.country
           FROM sessions s JOIN users u ON s.user_id = u.id
           WHERE s.token = ? AND u.suspended_at IS NULL`,
        )
        .get(token) as SessionRow | undefined;
      if (!row || !row.email || !row.display_name || !row.role || !row.country) return null;
      return {
        ...toRecord(row),
        user: {
          id: row.user_id,
          email: row.email,
          displayName: row.display_name,
          role: row.role,
          country: row.country,
        },
      };
    },
    listByUser(userId) {
      return db
        .prepare(
          `SELECT token, user_id, created_at, expires_at, last_seen_at, user_agent, ip_address_hash
           FROM sessions WHERE user_id = ? ORDER BY datetime(created_at) DESC, token DESC`,
        )
        .all(userId)
        .map((row) => toRecord(row as SessionRow));
    },
    findByShortId(sessionShortId) {
      const row = db
        .prepare(
          `SELECT token, user_id, created_at, expires_at, last_seen_at, user_agent, ip_address_hash
           FROM sessions WHERE substr(token, 1, 12) = ? LIMIT 1`,
        )
        .get(sessionShortId) as SessionRow | undefined;
      return row ? toRecord(row) : null;
    },
    delete(token) {
      return db.prepare('DELETE FROM sessions WHERE token = ?').run(token).changes === 1;
    },
    deleteByIdForUser(userId, sessionShortId) {
      return (
        db
          .prepare('DELETE FROM sessions WHERE user_id = ? AND substr(token, 1, 12) = ?')
          .run(userId, sessionShortId).changes === 1
      );
    },
    deleteForUser(userId) {
      return db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId).changes;
    },
    deleteOtherForUser(userId, token) {
      return db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(userId, token)
        .changes;
    },
    updateLastSeen(token, now, staleBefore) {
      return (
        db
          .prepare(
            `UPDATE sessions SET last_seen_at = ?
             WHERE token = ? AND (last_seen_at IS NULL OR last_seen_at <= ?)`,
          )
          .run(now, token, staleBefore).changes === 1
      );
    },
  };
}
