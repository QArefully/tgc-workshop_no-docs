import type Database from 'better-sqlite3';
import type { BuiltAuditEvent } from './auditEvent.js';
import type { NormalizedAuditEventQuery } from './auditQuery.js';

export interface AuditEventRecord {
  id: string;
  actorType: 'anonymous' | 'user' | 'system';
  actorUserId: number | null;
  action: string;
  entityType: string;
  entityId: string | null;
  requestId: string | null;
  metadata: Readonly<Record<string, string | number>>;
  occurredAt: string;
}

export interface AuditRepository {
  append(event: BuiltAuditEvent & { occurredAt: string }): void;
  list(query: NormalizedAuditEventQuery): AuditEventRecord[];
  count(query: NormalizedAuditEventQuery): number;
}

interface AuditEventRow {
  id: number;
  actor_type: AuditEventRecord['actorType'];
  actor_user_id: number | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  request_id: string | null;
  metadata_json: string;
  occurred_at: string;
}

interface Predicate {
  sql: string;
  values: (string | number)[];
}

function parseMetadata(metadataJson: string): Readonly<Record<string, string | number>> {
  let metadata: unknown;
  try {
    metadata = JSON.parse(metadataJson);
  } catch {
    throw new Error('Invalid persisted audit metadata JSON');
  }
  if (
    typeof metadata !== 'object' ||
    metadata === null ||
    Array.isArray(metadata) ||
    Object.values(metadata).some((value) => typeof value !== 'string' && typeof value !== 'number')
  ) {
    throw new Error('Invalid persisted audit metadata JSON');
  }
  return Object.freeze({ ...metadata } as Record<string, string | number>);
}

function toRecord(row: AuditEventRow): AuditEventRecord {
  return {
    id: String(row.id),
    actorType: row.actor_type,
    actorUserId: row.actor_user_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    requestId: row.request_id,
    metadata: parseMetadata(row.metadata_json),
    occurredAt: row.occurred_at,
  };
}

/** Builds every supported exact-match filter once for count and paginated result queries. */
function buildPredicate(query: NormalizedAuditEventQuery): Predicate {
  const clauses: string[] = [];
  const values: (string | number)[] = [];
  const add = (sql: string, value: string | number | undefined): void => {
    if (value === undefined) return;
    clauses.push(sql);
    values.push(value);
  };

  add('action = ?', query.action);
  add('entity_type = ?', query.entityType);
  add('entity_id = ?', query.entityId);
  add('actor_user_id = ?', query.actorUserId);
  add('request_id = ?', query.requestId);
  add('occurred_at >= ?', query.occurredFrom);
  add('occurred_at <= ?', query.occurredTo);

  return { sql: clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`, values };
}

export function createAuditRepository(db: Database.Database): AuditRepository {
  return {
    append(event) {
      db.prepare(
        `INSERT INTO audit_events
          (actor_type, actor_user_id, action, entity_type, entity_id, request_id, metadata_json, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        event.actorType,
        event.actorUserId,
        event.action,
        event.entityType,
        event.entityId,
        event.requestId,
        event.metadataJson,
        event.occurredAt,
      );
    },
    list(query) {
      const predicate = buildPredicate(query);
      const offset = (query.page - 1) * query.pageSize;
      return db
        .prepare(
          `SELECT id, actor_type, actor_user_id, action, entity_type, entity_id, request_id,
                  metadata_json, occurred_at
           FROM audit_events${predicate.sql}
           ORDER BY occurred_at DESC, id DESC
           LIMIT ? OFFSET ?`,
        )
        .all(...predicate.values, query.pageSize, offset)
        .map((row) => toRecord(row as AuditEventRow));
    },
    count(query) {
      const predicate = buildPredicate(query);
      return (
        db
          .prepare(`SELECT COUNT(*) AS count FROM audit_events${predicate.sql}`)
          .get(...predicate.values) as {
          count: number;
        }
      ).count;
    },
  };
}
