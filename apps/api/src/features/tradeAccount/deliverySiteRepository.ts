import type Database from 'better-sqlite3';
import type { DeliverySite } from '@shop/contracts/trade-account';
import type { Country } from '@shop/contracts/country';
import { toIsoInstant, toPostalAddress, type AddressColumns } from './addressRules.js';

/** Persistence shape of one `delivery_sites` row. Owned here; no other module reads column names. */
export interface DeliverySiteRow extends AddressColumns {
  id: number;
  user_id: number;
  label: string;
  contact_name: string;
  contact_phone: string | null;
  is_default: number;
  active: number;
  created_at: string;
  updated_at: string;
}

/** Column values written on insert. Address parts arrive already normalised. */
export interface DeliverySiteInsert extends AddressColumns {
  user_id: number;
  label: string;
  contact_name: string;
  /**
   * NULL, never `''`: the column CHECK is `IS NULL OR length(...) BETWEEN 1 AND 40`, so a value that
   * normalised away must be written as NULL rather than raised as a `SQLITE_CONSTRAINT` failure.
   */
  contact_phone: string | null;
  is_default: boolean;
  now: string;
}

/** Partial column patch. An absent key leaves the stored column untouched. */
export interface DeliverySiteUpdate extends Partial<AddressColumns> {
  label?: string;
  contact_name?: string;
  /** See `DeliverySiteInsert.contact_phone`: a normalised-empty patch value is NULL, not `''`. */
  contact_phone?: string | null;
}

export interface DeliverySiteRepository {
  /** Persisted identity country for the owning account; never inferred from a postal address. */
  accountCountry(userId: number): Country | undefined;
  listActive(userId: number): DeliverySiteRow[];
  countActive(userId: number): number;
  findActiveById(userId: number, siteId: number): DeliverySiteRow | undefined;
  findById(userId: number, siteId: number): DeliverySiteRow | undefined;
  findActiveByLabel(userId: number, label: string): DeliverySiteRow | undefined;
  findOldestActive(userId: number, excludeSiteId: number): DeliverySiteRow | undefined;
  insert(input: DeliverySiteInsert): DeliverySiteRow;
  update(userId: number, siteId: number, patch: DeliverySiteUpdate, now: string): void;
  clearDefault(userId: number, now: string): void;
  markDefault(userId: number, siteId: number, now: string): void;
  retire(userId: number, siteId: number, now: string): void;
}

const COLUMNS = `id, user_id, label, contact_name, contact_phone,
  address_line1, address_line2, address_city, address_region, address_postcode,
  address_country_code, is_default, active, created_at, updated_at`;

/**
 * One transport mapper for the delivery-site record. `id` is rendered as a string because the
 * contract models record identifiers as positive integer strings.
 *
 * `contact_phone` is nullable and the contract field is optional, so a NULL maps to an absent field
 * rather than `''`. The empty string satisfies neither the column CHECK nor the contract's
 * `ContactPhone` bounds, so emitting it would turn a legitimately phone-less row into a response
 * validation failure (a 500) on every read of that row.
 */
export function toDeliverySite(row: DeliverySiteRow): DeliverySite {
  return {
    id: String(row.id),
    label: row.label,
    contactName: row.contact_name,
    ...(row.contact_phone === null ? {} : { contactPhone: row.contact_phone }),
    address: toPostalAddress(row),
    isDefault: row.is_default === 1,
    active: row.active === 1,
    createdAt: toIsoInstant(row.created_at),
    updatedAt: toIsoInstant(row.updated_at),
  };
}

export function createDeliverySiteRepository(db: Database.Database): DeliverySiteRepository {
  return {
    accountCountry(userId) {
      return db.prepare('SELECT country FROM users WHERE id = ?').pluck().get(userId) as
        Country | undefined;
    },
    listActive(userId) {
      return db
        .prepare(
          `SELECT ${COLUMNS} FROM delivery_sites
           WHERE user_id = ? AND active = 1
           ORDER BY is_default DESC, label COLLATE NOCASE ASC, id ASC`,
        )
        .all(userId) as DeliverySiteRow[];
    },
    countActive(userId) {
      const row = db
        .prepare('SELECT COUNT(*) AS total FROM delivery_sites WHERE user_id = ? AND active = 1')
        .get(userId) as { total: number };
      return row.total;
    },
    findActiveById(userId, siteId) {
      return db
        .prepare(
          `SELECT ${COLUMNS} FROM delivery_sites WHERE id = ? AND user_id = ? AND active = 1`,
        )
        .get(siteId, userId) as DeliverySiteRow | undefined;
    },
    // Deliberately ignores `active`: order hydration must still resolve a retired site.
    findById(userId, siteId) {
      return db
        .prepare(`SELECT ${COLUMNS} FROM delivery_sites WHERE id = ? AND user_id = ?`)
        .get(siteId, userId) as DeliverySiteRow | undefined;
    },
    findActiveByLabel(userId, label) {
      return db
        .prepare(
          `SELECT ${COLUMNS} FROM delivery_sites
           WHERE user_id = ? AND active = 1 AND label = ? COLLATE NOCASE`,
        )
        .get(userId, label) as DeliverySiteRow | undefined;
    },
    findOldestActive(userId, excludeSiteId) {
      return db
        .prepare(
          `SELECT ${COLUMNS} FROM delivery_sites
           WHERE user_id = ? AND active = 1 AND id != ?
           ORDER BY id ASC LIMIT 1`,
        )
        .get(userId, excludeSiteId) as DeliverySiteRow | undefined;
    },
    insert(input) {
      const result = db
        .prepare(
          `INSERT INTO delivery_sites (
             user_id, label, contact_name, contact_phone,
             address_line1, address_line2, address_city, address_region, address_postcode,
             address_country_code, is_default, active, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(
          input.user_id,
          input.label,
          input.contact_name,
          input.contact_phone,
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
        .prepare(`SELECT ${COLUMNS} FROM delivery_sites WHERE id = ?`)
        .get(Number(result.lastInsertRowid)) as DeliverySiteRow;
    },
    update(userId, siteId, patch, now) {
      const assignments: string[] = [];
      const values: (string | null)[] = [];
      for (const column of Object.keys(patch)) {
        const value = patch[column as keyof DeliverySiteUpdate];
        if (value === undefined) continue;
        assignments.push(`${column} = ?`);
        values.push(value);
      }
      assignments.push('updated_at = ?');
      values.push(now);
      db.prepare(
        `UPDATE delivery_sites SET ${assignments.join(', ')} WHERE id = ? AND user_id = ?`,
      ).run(...values, siteId, userId);
    },
    clearDefault(userId, now) {
      db.prepare(
        `UPDATE delivery_sites SET is_default = 0, updated_at = ?
         WHERE user_id = ? AND is_default = 1`,
      ).run(now, userId);
    },
    markDefault(userId, siteId, now) {
      db.prepare(
        `UPDATE delivery_sites SET is_default = 1, updated_at = ?
         WHERE id = ? AND user_id = ? AND active = 1`,
      ).run(now, siteId, userId);
    },
    // Retire, never delete: historic orders keep a live foreign key to the row.
    retire(userId, siteId, now) {
      db.prepare(
        `UPDATE delivery_sites SET active = 0, is_default = 0, updated_at = ?
         WHERE id = ? AND user_id = ?`,
      ).run(now, siteId, userId);
    },
  };
}
