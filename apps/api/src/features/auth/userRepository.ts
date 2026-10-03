import type Database from 'better-sqlite3';
import type { PublicUser } from '@shop/contracts/auth';

export interface UserRecord {
  id: number;
  email: string;
  displayName: string;
  role: PublicUser['role'];
  country: string;
}

export interface UserCredentials extends UserRecord {
  passwordHash: string;
  passwordSalt: string;
  suspendedAt: string | null;
}

interface UserRow {
  id: number;
  email: string;
  display_name: string;
  role: PublicUser['role'];
  password_hash?: string;
  password_salt?: string;
  suspended_at?: string | null;
  country: string;
}

export interface UserRepository {
  create(input: {
    email: string;
    displayName: string;
    country: string;
    passwordHash: string;
    now: string;
  }): UserRecord;
  findCredentialsByEmail(email: string, country: string): UserCredentials | null;
  findCredentialsById(userId: number): UserCredentials | null;
  updatePassword(userId: number, passwordHash: string): void;
}

function toUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    country: row.country,
  };
}

export function createUserRepository(db: Database.Database): UserRepository {
  return {
    create({ email, displayName, country, passwordHash, now }) {
      const result = db
        .prepare(
          `INSERT INTO users (email, display_name, password_hash, password_salt, role, created_at, country)
           VALUES (?, ?, ?, '', 'customer', ?, ?)`,
        )
        .run(email, displayName, passwordHash, now, country);
      const row = db
        .prepare('SELECT id, email, display_name, role, country FROM users WHERE id = ?')
        .get(Number(result.lastInsertRowid)) as UserRow;
      return toUser(row);
    },
    findCredentialsByEmail(email, country) {
      const row = db
        .prepare(
          `SELECT id, email, display_name, role, password_hash, password_salt, suspended_at, country
           FROM users WHERE email = ? AND country = ?`,
        )
        .get(email, country) as UserRow | undefined;
      return row
        ? {
            ...toUser(row),
            passwordHash: row.password_hash ?? '',
            passwordSalt: row.password_salt ?? '',
            suspendedAt: row.suspended_at ?? null,
          }
        : null;
    },
    findCredentialsById(userId) {
      const row = db
        .prepare(
          `SELECT id, email, display_name, role, password_hash, password_salt, suspended_at, country
           FROM users WHERE id = ?`,
        )
        .get(userId) as UserRow | undefined;
      return row
        ? {
            ...toUser(row),
            passwordHash: row.password_hash ?? '',
            passwordSalt: row.password_salt ?? '',
            suspendedAt: row.suspended_at ?? null,
          }
        : null;
    },
    updatePassword(userId, passwordHash) {
      db.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?').run(
        passwordHash,
        '',
        userId,
      );
    },
  };
}
