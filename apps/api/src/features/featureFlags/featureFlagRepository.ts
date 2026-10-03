import type Database from 'better-sqlite3';

export interface FeatureFlagRecord {
  key: string;
  description: string;
  enabled: boolean;
  updatedAt: string;
  updatedByUserId: number | null;
}

export interface FeatureFlagCreate {
  key: string;
  description: string;
  enabled: boolean;
  updatedByUserId: number | null;
}

export interface FeatureFlagUpdate {
  description?: string;
  enabled?: boolean;
  updatedByUserId: number | null;
}

export interface FeatureFlagRepository {
  list(): FeatureFlagRecord[];
  get(key: string): FeatureFlagRecord | undefined;
  create(input: FeatureFlagCreate): FeatureFlagRecord;
  update(key: string, input: FeatureFlagUpdate): FeatureFlagRecord | undefined;
  delete(key: string): boolean;
}

interface FeatureFlagRow {
  key: string;
  description: string;
  enabled: number;
  updated_at: string;
  updated_by_user_id: number | null;
}

function toRecord(row: FeatureFlagRow): FeatureFlagRecord {
  return {
    key: row.key,
    description: row.description,
    enabled: row.enabled === 1,
    updatedAt: row.updated_at,
    updatedByUserId: row.updated_by_user_id,
  };
}

/** SQLite storage only. Service owns validation, audit, and transaction boundaries. */
export function createFeatureFlagRepository(db: Database.Database): FeatureFlagRepository {
  const select = `SELECT key, description, enabled, updated_at, updated_by_user_id FROM feature_flags`;
  const get = (key: string): FeatureFlagRecord | undefined => {
    const row = db.prepare(`${select} WHERE key = ?`).get(key) as FeatureFlagRow | undefined;
    return row ? toRecord(row) : undefined;
  };

  return {
    list() {
      return db
        .prepare(`${select} ORDER BY key ASC`)
        .all()
        .map((row) => toRecord(row as FeatureFlagRow));
    },
    get,
    create(input) {
      db.prepare(
        `INSERT INTO feature_flags (key, description, enabled, updated_by_user_id)
         VALUES (?, ?, ?, ?)`,
      ).run(input.key, input.description, input.enabled ? 1 : 0, input.updatedByUserId);
      return get(input.key)!;
    },
    update(key, input) {
      const assignments: string[] = ["updated_at = datetime('now')", 'updated_by_user_id = ?'];
      const values: (string | number | null)[] = [input.updatedByUserId];
      if (input.description !== undefined) {
        assignments.push('description = ?');
        values.push(input.description);
      }
      if (input.enabled !== undefined) {
        assignments.push('enabled = ?');
        values.push(input.enabled ? 1 : 0);
      }
      const result = db
        .prepare(`UPDATE feature_flags SET ${assignments.join(', ')} WHERE key = ?`)
        .run(...values, key);
      return result.changes === 1 ? get(key) : undefined;
    },
    delete(key) {
      return db.prepare('DELETE FROM feature_flags WHERE key = ?').run(key).changes === 1;
    },
  };
}
