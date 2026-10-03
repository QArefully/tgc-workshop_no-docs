import type { Migration } from '../migrate.js';

/** Replace legacy plaintext reset tokens. Existing outstanding links are deliberately revoked. */
export const passwordResetTokenDigestMigration: Migration = {
  version: '006',
  name: 'password reset token digest',
  up(db) {
    const columns = db.prepare('PRAGMA table_info(password_reset_tokens)').all() as {
      name: string;
    }[];
    if (columns.some((column) => column.name === 'token_digest')) {
      db.exec(
        `CREATE INDEX IF NOT EXISTS password_reset_tokens_user_active_idx
         ON password_reset_tokens(user_id, used_at, expires_at)`,
      );
      return;
    }
    db.exec(`
      ALTER TABLE password_reset_tokens RENAME TO password_reset_tokens_legacy;

      CREATE TABLE password_reset_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token_digest TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX password_reset_tokens_user_active_idx
        ON password_reset_tokens(user_id, used_at, expires_at);

      DROP TABLE password_reset_tokens_legacy;
    `);
  },
};
