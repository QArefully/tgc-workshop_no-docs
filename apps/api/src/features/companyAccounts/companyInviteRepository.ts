import type Database from 'better-sqlite3';
import type { CompanyInviteRole, CompanyInviteStatus } from '@shop/contracts/company-accounts';

export interface CompanyInviteRow {
  id: number;
  company_id: number;
  email: string;
  role: CompanyInviteRole;
  token_digest: string;
  status: CompanyInviteStatus;
  expires_at: string;
  created_at: string;
  resolved_at: string | null;
}
export interface CompanyInviteRepository {
  create(input: {
    companyId: number;
    email: string;
    role: CompanyInviteRole;
    tokenDigest: string;
    expiresAt: string;
    now: string;
  }): CompanyInviteRow;
  findByDigest(tokenDigest: string): CompanyInviteRow | null;
  findPendingByEmail(companyId: number, email: string): CompanyInviteRow | null;
  findPendingById(companyId: number, inviteId: number): CompanyInviteRow | null;
  listPendingByCompany(companyId: number): CompanyInviteRow[];
  markAccepted(id: number, now: string): boolean;
  markRevoked(companyId: number, inviteId: number, now: string): boolean;
  expireStale(now: string): void;
}
function toRow(row: CompanyInviteRow | undefined): CompanyInviteRow | null {
  return row ?? null;
}
export function createCompanyInviteRepository(db: Database.Database): CompanyInviteRepository {
  return {
    create({ companyId, email, role, tokenDigest, expiresAt, now }) {
      const id = Number(
        db
          .prepare(
            `INSERT INTO company_invites
        (company_id, email, role, token_digest, status, expires_at, created_at, resolved_at)
        VALUES (?, ?, ?, ?, 'pending', ?, ?, NULL)`,
          )
          .run(companyId, email, role, tokenDigest, expiresAt, now).lastInsertRowid,
      );
      return db.prepare('SELECT * FROM company_invites WHERE id = ?').get(id) as CompanyInviteRow;
    },
    findByDigest(tokenDigest) {
      return toRow(
        db.prepare('SELECT * FROM company_invites WHERE token_digest = ?').get(tokenDigest) as
          CompanyInviteRow | undefined,
      );
    },
    findPendingByEmail(companyId, email) {
      return toRow(
        db
          .prepare(
            "SELECT * FROM company_invites WHERE company_id = ? AND email = ? AND status = 'pending'",
          )
          .get(companyId, email) as CompanyInviteRow | undefined,
      );
    },
    findPendingById(companyId, inviteId) {
      return toRow(
        db
          .prepare(
            "SELECT * FROM company_invites WHERE company_id = ? AND id = ? AND status = 'pending'",
          )
          .get(companyId, inviteId) as CompanyInviteRow | undefined,
      );
    },
    listPendingByCompany(companyId) {
      return db
        .prepare(
          "SELECT * FROM company_invites WHERE company_id = ? AND status = 'pending' ORDER BY created_at, id",
        )
        .all(companyId) as CompanyInviteRow[];
    },
    markAccepted(id, now) {
      return (
        db
          .prepare(
            "UPDATE company_invites SET status = 'accepted', resolved_at = ? WHERE id = ? AND status = 'pending'",
          )
          .run(now, id).changes === 1
      );
    },
    markRevoked(companyId, inviteId, now) {
      return (
        db
          .prepare(
            "UPDATE company_invites SET status = 'revoked', resolved_at = ? WHERE company_id = ? AND id = ? AND status = 'pending'",
          )
          .run(now, companyId, inviteId).changes === 1
      );
    },
    expireStale(now) {
      db.prepare(
        "UPDATE company_invites SET status = 'expired', resolved_at = ? WHERE status = 'pending' AND expires_at <= ?",
      ).run(now, now);
    },
  };
}
