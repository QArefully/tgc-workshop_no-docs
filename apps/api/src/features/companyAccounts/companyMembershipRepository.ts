import type Database from 'better-sqlite3';
import type { CompanyMembershipRole } from '@shop/contracts/company-accounts';

export interface CompanyMembershipRow {
  id: number;
  company_id: number;
  user_id: number;
  role: CompanyMembershipRole;
  active: number;
  created_at: string;
  email?: string;
  display_name?: string;
  user_role?: 'customer' | 'admin';
  country?: string;
}

export interface CompanyMembershipRepository {
  create(input: {
    companyId: number;
    userId: number;
    role: CompanyMembershipRole;
    now: string;
  }): CompanyMembershipRow;
  findActiveByUser(userId: number): CompanyMembershipRow | null;
  findActiveById(companyId: number, membershipId: number): CompanyMembershipRow | null;
  listActiveByCompany(companyId: number): CompanyMembershipRow[];
  retire(companyId: number, membershipId: number): boolean;
  changeRole(companyId: number, membershipId: number, role: 'buyer' | 'approver'): boolean;
}

const select = `SELECT membership.id, membership.company_id, membership.user_id, membership.role,
  membership.active, membership.created_at, user.email, user.display_name, user.role AS user_role, user.country
  FROM company_memberships membership JOIN users user ON user.id = membership.user_id`;

export function createCompanyMembershipRepository(
  db: Database.Database,
): CompanyMembershipRepository {
  const by = (sql: string, ...values: number[]) =>
    (db.prepare(`${select} ${sql}`).get(...values) as CompanyMembershipRow | undefined) ?? null;
  return {
    create({ companyId, userId, role, now }) {
      const id = Number(
        db
          .prepare(
            `INSERT INTO company_memberships
        (company_id, user_id, role, active, created_at) VALUES (?, ?, ?, 1, ?)`,
          )
          .run(companyId, userId, role, now).lastInsertRowid,
      );
      return by('WHERE membership.id = ?', id)!;
    },
    findActiveByUser(userId) {
      return by('WHERE membership.user_id = ? AND membership.active = 1', userId);
    },
    findActiveById(companyId, membershipId) {
      return by(
        'WHERE membership.company_id = ? AND membership.id = ? AND membership.active = 1',
        companyId,
        membershipId,
      );
    },
    listActiveByCompany(companyId) {
      return db
        .prepare(
          `${select} WHERE membership.company_id = ? AND membership.active = 1 ORDER BY membership.created_at, membership.id`,
        )
        .all(companyId) as CompanyMembershipRow[];
    },
    retire(companyId, membershipId) {
      return (
        db
          .prepare(
            'UPDATE company_memberships SET active = 0 WHERE company_id = ? AND id = ? AND active = 1',
          )
          .run(companyId, membershipId).changes === 1
      );
    },
    changeRole(companyId, membershipId, role) {
      return (
        db
          .prepare(
            'UPDATE company_memberships SET role = ? WHERE company_id = ? AND id = ? AND active = 1',
          )
          .run(role, companyId, membershipId).changes === 1
      );
    },
  };
}
