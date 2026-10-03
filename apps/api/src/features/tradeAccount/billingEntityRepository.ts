import type Database from 'better-sqlite3';
import type { BillingEntity, BillingEntitySnapshot } from '@shop/contracts/trade-account';
import { toIsoInstant, toPostalAddress, type AddressColumns } from './addressRules.js';

/** Persistence shape of one `billing_entities` row. Owned here; no other module reads column names. */
export interface BillingEntityRow extends AddressColumns {
  id: number;
  user_id: number;
  legal_name: string;
  registration_number: string | null;
  vat_number: string | null;
  is_default: number;
  active: number;
  created_at: string;
  updated_at: string;
}

/** Column values written on insert. Address parts arrive already normalised. */
export interface BillingEntityInsert extends AddressColumns {
  user_id: number;
  legal_name: string;
  registration_number: string | null;
  vat_number: string | null;
  is_default: boolean;
  now: string;
}

/** Partial column patch. An absent key leaves the stored column untouched. */
export interface BillingEntityUpdate extends Partial<AddressColumns> {
  legal_name?: string;
  registration_number?: string | null;
  vat_number?: string | null;
}

export interface BillingEntityRepository {
  listActive(userId: number): BillingEntityRow[];
  countActive(userId: number): number;
  findActiveById(userId: number, entityId: number): BillingEntityRow | undefined;
  findById(userId: number, entityId: number): BillingEntityRow | undefined;
  findActiveByLegalName(userId: number, legalName: string): BillingEntityRow | undefined;
  findOldestActive(userId: number, excludeEntityId: number): BillingEntityRow | undefined;
  insert(input: BillingEntityInsert): BillingEntityRow;
  update(userId: number, entityId: number, patch: BillingEntityUpdate, now: string): void;
  clearDefault(userId: number, now: string): void;
  markDefault(userId: number, entityId: number, now: string): void;
  retire(userId: number, entityId: number, now: string): void;
}

const COLUMNS = `id, user_id, legal_name, registration_number, vat_number,
  address_line1, address_line2, address_city, address_region, address_postcode,
  address_country_code, is_default, active, created_at, updated_at`;

/** One transport mapper for the billing-entity record. */
export function toBillingEntity(row: BillingEntityRow): BillingEntity {
  return {
    id: String(row.id),
    legalName: row.legal_name,
    registrationNumber: row.registration_number,
    vatNumber: row.vat_number,
    address: toPostalAddress(row),
    isDefault: row.is_default === 1,
    active: row.active === 1,
    createdAt: toIsoInstant(row.created_at),
    updatedAt: toIsoInstant(row.updated_at),
  };
}

/**
 * Freezes the billed-party facts an order keeps. Identifier-free by design: editing or retiring the
 * saved entity afterwards must not rewrite what a past order says it billed.
 */
export function toBillingEntitySnapshot(entity: BillingEntity): BillingEntitySnapshot {
  return {
    legalName: entity.legalName,
    registrationNumber: entity.registrationNumber,
    vatNumber: entity.vatNumber,
    address: entity.address,
  };
}

export function createBillingEntityRepository(db: Database.Database): BillingEntityRepository {
  return {
    listActive(userId) {
      return db
        .prepare(
          `SELECT ${COLUMNS} FROM billing_entities
           WHERE user_id = ? AND active = 1
           ORDER BY is_default DESC, legal_name COLLATE NOCASE ASC, id ASC`,
        )
        .all(userId) as BillingEntityRow[];
    },
    countActive(userId) {
      const row = db
        .prepare('SELECT COUNT(*) AS total FROM billing_entities WHERE user_id = ? AND active = 1')
        .get(userId) as { total: number };
      return row.total;
    },
    findActiveById(userId, entityId) {
      return db
        .prepare(
          `SELECT ${COLUMNS} FROM billing_entities WHERE id = ? AND user_id = ? AND active = 1`,
        )
        .get(entityId, userId) as BillingEntityRow | undefined;
    },
    // Deliberately ignores `active`: order hydration must still resolve a retired entity.
    findById(userId, entityId) {
      return db
        .prepare(`SELECT ${COLUMNS} FROM billing_entities WHERE id = ? AND user_id = ?`)
        .get(entityId, userId) as BillingEntityRow | undefined;
    },
    findActiveByLegalName(userId, legalName) {
      return db
        .prepare(
          `SELECT ${COLUMNS} FROM billing_entities
           WHERE user_id = ? AND active = 1 AND legal_name = ? COLLATE NOCASE`,
        )
        .get(userId, legalName) as BillingEntityRow | undefined;
    },
    findOldestActive(userId, excludeEntityId) {
      return db
        .prepare(
          `SELECT ${COLUMNS} FROM billing_entities
           WHERE user_id = ? AND active = 1 AND id != ?
           ORDER BY id ASC LIMIT 1`,
        )
        .get(userId, excludeEntityId) as BillingEntityRow | undefined;
    },
    insert(input) {
      const result = db
        .prepare(
          `INSERT INTO billing_entities (
             user_id, legal_name, registration_number, vat_number,
             address_line1, address_line2, address_city, address_region, address_postcode,
             address_country_code, is_default, active, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(
          input.user_id,
          input.legal_name,
          input.registration_number,
          input.vat_number,
          input.address_line1,
          input.address_line2,
          input.address_city,
          input.address_region,
          input.address_postcode,
          input.address_country_code,
          input.is_default ? 1 : 0,
          input.now,
          input.now,
        );
      return db
        .prepare(`SELECT ${COLUMNS} FROM billing_entities WHERE id = ?`)
        .get(Number(result.lastInsertRowid)) as BillingEntityRow;
    },
    update(userId, entityId, patch, now) {
      const assignments: string[] = [];
      const values: (string | null)[] = [];
      for (const column of Object.keys(patch)) {
        const value = patch[column as keyof BillingEntityUpdate];
        if (value === undefined) continue;
        assignments.push(`${column} = ?`);
        values.push(value);
      }
      assignments.push('updated_at = ?');
      values.push(now);
      db.prepare(
        `UPDATE billing_entities SET ${assignments.join(', ')} WHERE id = ? AND user_id = ?`,
      ).run(...values, entityId, userId);
    },
    clearDefault(userId, now) {
      db.prepare(
        `UPDATE billing_entities SET is_default = 0, updated_at = ?
         WHERE user_id = ? AND is_default = 1`,
      ).run(now, userId);
    },
    markDefault(userId, entityId, now) {
      db.prepare(
        `UPDATE billing_entities SET is_default = 1, updated_at = ?
         WHERE id = ? AND user_id = ? AND active = 1`,
      ).run(now, entityId, userId);
    },
    // Retire, never delete: historic orders snapshot the entity that billed them.
    retire(userId, entityId, now) {
      db.prepare(
        `UPDATE billing_entities SET active = 0, is_default = 0, updated_at = ?
         WHERE id = ? AND user_id = ?`,
      ).run(now, entityId, userId);
    },
  };
}
