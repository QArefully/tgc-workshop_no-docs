import type Database from 'better-sqlite3';
import type {
  Notification,
  NotificationKind,
  NotificationReadStatus,
} from '@shop/contracts/notifications';

interface NotificationRow {
  id: number;
  user_id: number;
  kind: NotificationKind;
  title: string;
  body: string;
  entity_type: string | null;
  entity_id: string | null;
  dedupe_key: string;
  created_at: string;
  read_at: string | null;
}

export interface NotificationDeliveryRecord {
  notification: Notification;
  userId: number;
  recipient: string;
}

function toNotification(row: NotificationRow): Notification {
  return {
    id: String(row.id),
    kind: row.kind,
    title: row.title,
    body: row.body,
    entityType: row.entity_type,
    entityId: row.entity_id,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

export interface NotificationRepository {
  insertIfAbsent(input: {
    userId: number;
    kind: NotificationKind;
    title: string;
    body: string;
    entityType: string | null;
    entityId: string | null;
    dedupeKey: string;
    createdAt: string;
  }): { created: boolean; notification: Notification };
  get(notificationId: number): { notification: Notification; userId: number } | undefined;
  getOwned(userId: number, notificationId: number): Notification | undefined;
  getDelivery(notificationId: number): NotificationDeliveryRecord | undefined;
  listOwned(input: {
    userId: number;
    status?: NotificationReadStatus;
    limit: number;
    offset: number;
  }): Notification[];
  countOwned(userId: number, status?: NotificationReadStatus): number;
  markRead(userId: number, notificationId: number, readAt: string): boolean;
  markAllRead(userId: number, readAt: string): number[];
}

export function createNotificationRepository(db: Database.Database): NotificationRepository {
  return {
    insertIfAbsent(input) {
      const result = db
        .prepare(
          `INSERT INTO notifications (user_id, kind, title, body, entity_type, entity_id, dedupe_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(dedupe_key) DO NOTHING`,
        )
        .run(
          input.userId,
          input.kind,
          input.title,
          input.body,
          input.entityType,
          input.entityId,
          input.dedupeKey,
          input.createdAt,
        );
      const row = result.changes
        ? db.prepare('SELECT * FROM notifications WHERE id = ?').get(Number(result.lastInsertRowid))
        : db.prepare('SELECT * FROM notifications WHERE dedupe_key = ?').get(input.dedupeKey);
      if (!row) throw new Error('Notification dedupe reservation disappeared');
      return {
        created: result.changes === 1,
        notification: toNotification(row as NotificationRow),
      };
    },
    get(notificationId) {
      const row = db.prepare('SELECT * FROM notifications WHERE id = ?').get(notificationId) as
        NotificationRow | undefined;
      return row && { notification: toNotification(row), userId: row.user_id };
    },
    getOwned(userId, notificationId) {
      const row = db
        .prepare('SELECT * FROM notifications WHERE id = ? AND user_id = ?')
        .get(notificationId, userId) as NotificationRow | undefined;
      return row && toNotification(row);
    },
    getDelivery(notificationId) {
      const row = db
        .prepare(
          `SELECT n.*, u.email AS recipient FROM notifications n JOIN users u ON u.id = n.user_id WHERE n.id = ?`,
        )
        .get(notificationId) as (NotificationRow & { recipient: string }) | undefined;
      return (
        row && { notification: toNotification(row), userId: row.user_id, recipient: row.recipient }
      );
    },
    listOwned({ userId, status, limit, offset }) {
      const readFilter =
        status === 'read'
          ? ' AND read_at IS NOT NULL'
          : status === 'unread'
            ? ' AND read_at IS NULL'
            : '';
      return (
        db
          .prepare(
            `SELECT * FROM notifications WHERE user_id = ?${readFilter} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
          )
          .all(userId, limit, offset) as NotificationRow[]
      ).map(toNotification);
    },
    countOwned(userId, status) {
      const readFilter =
        status === 'read'
          ? ' AND read_at IS NOT NULL'
          : status === 'unread'
            ? ' AND read_at IS NULL'
            : '';
      return (
        db
          .prepare(`SELECT COUNT(*) AS count FROM notifications WHERE user_id = ?${readFilter}`)
          .get(userId) as { count: number }
      ).count;
    },
    markRead(userId, notificationId, readAt) {
      return (
        db
          .prepare(
            'UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL',
          )
          .run(readAt, notificationId, userId).changes === 1
      );
    },
    markAllRead(userId, readAt) {
      const rows = db
        .prepare('SELECT id FROM notifications WHERE user_id = ? AND read_at IS NULL')
        .all(userId) as { id: number }[];
      if (rows.length)
        db.prepare(
          'UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL',
        ).run(readAt, userId);
      return rows.map((row) => row.id);
    },
  };
}
