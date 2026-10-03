import type { Migration } from '../migrate.js';

/** Creates immutable, foreign-key-free audit ledger storage. */
export const auditEventsMigration: Migration = {
  version: '011',
  name: 'append-only audit events',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_type TEXT NOT NULL CHECK (actor_type IN ('anonymous', 'user', 'system')),
        actor_user_id INTEGER,
        action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 100),
        entity_type TEXT NOT NULL CHECK (length(entity_type) BETWEEN 1 AND 64),
        entity_id TEXT CHECK (entity_id IS NULL OR length(entity_id) <= 255),
        request_id TEXT CHECK (request_id IS NULL OR length(request_id) <= 255),
        metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
        occurred_at TEXT NOT NULL,
        CHECK (
          (actor_type = 'user' AND actor_user_id IS NOT NULL) OR
          (actor_type IN ('anonymous', 'system') AND actor_user_id IS NULL)
        ),
        CHECK (actor_type = 'system' OR request_id IS NOT NULL)
      );

      CREATE INDEX IF NOT EXISTS audit_events_occurred_at_id_idx
        ON audit_events(occurred_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS audit_events_action_occurred_at_id_idx
        ON audit_events(action, occurred_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS audit_events_entity_occurred_at_id_idx
        ON audit_events(entity_type, entity_id, occurred_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS audit_events_actor_user_occurred_at_id_idx
        ON audit_events(actor_user_id, occurred_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS audit_events_request_occurred_at_id_idx
        ON audit_events(request_id, occurred_at DESC, id DESC);

      CREATE TRIGGER IF NOT EXISTS audit_events_no_update
      BEFORE UPDATE ON audit_events
      BEGIN
        SELECT RAISE(ABORT, 'audit_events are append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS audit_events_no_delete
      BEFORE DELETE ON audit_events
      BEGIN
        SELECT RAISE(ABORT, 'audit_events are append-only');
      END;
    `);
  },
};
