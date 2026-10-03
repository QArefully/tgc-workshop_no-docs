import type Database from 'better-sqlite3';
import type { PaymentWebhookBody, PaymentWebhookEventType } from '@shop/contracts/webhooks';

export type CapturedWebhookStatus = 'captured' | 'processed' | 'ignored_stale' | 'rejected';
export interface CapturedWebhook {
  id: number;
  source: 'simulated_payments';
  eventId: string;
  /** Persisted values are untrusted at processing time, even though capture validates new payloads. */
  eventType: string;
  payload: PaymentWebhookBody;
  requestFingerprint: string;
  receivedAt: string;
  status: CapturedWebhookStatus;
  processedAt: string | null;
  failureReason: string | null;
  jobId: number | null;
}
interface Row {
  id: number;
  source: 'simulated_payments';
  event_id: string;
  event_type: string;
  payload_json: string;
  request_fingerprint: string;
  received_at: string;
  status: CapturedWebhookStatus;
  processed_at: string | null;
  failure_reason: string | null;
  job_id: number | null;
}
function record(row: Row): CapturedWebhook {
  let payload: PaymentWebhookBody;
  try {
    payload = JSON.parse(row.payload_json) as PaymentWebhookBody;
  } catch {
    throw new Error('Invalid captured webhook payload JSON');
  }
  return {
    id: row.id,
    source: row.source,
    eventId: row.event_id,
    eventType: row.event_type,
    payload,
    requestFingerprint: row.request_fingerprint,
    receivedAt: row.received_at,
    status: row.status,
    processedAt: row.processed_at,
    failureReason: row.failure_reason,
    jobId: row.job_id,
  };
}
export interface WebhookRepository {
  capture(input: {
    eventId: string;
    eventType: PaymentWebhookEventType;
    payload: PaymentWebhookBody;
    rawPayload: string;
    requestFingerprint: string;
    receivedAt: string;
  }): { created: boolean; webhook: CapturedWebhook };
  get(id: number): CapturedWebhook | undefined;
  getByEventId(eventId: string): CapturedWebhook | undefined;
  setJob(id: number, jobId: number): void;
  settle(input: {
    id: number;
    status: Exclude<CapturedWebhookStatus, 'captured'>;
    processedAt: string;
    failureReason?: string | null;
  }): void;
  list(input: { status?: CapturedWebhookStatus; limit: number; offset: number }): CapturedWebhook[];
  count(status?: CapturedWebhookStatus): number;
  findOrderOwner(orderId: number): number | null;
}
export function createWebhookRepository(db: Database.Database): WebhookRepository {
  const get = (id: number) => {
    const row = db.prepare('SELECT * FROM captured_webhooks WHERE id=?').get(id) as Row | undefined;
    return row && record(row);
  };
  const byEvent = (eventId: string) => {
    const row = db.prepare('SELECT * FROM captured_webhooks WHERE event_id=?').get(eventId) as
      Row | undefined;
    return row && record(row);
  };
  return {
    capture(input) {
      const result = db
        .prepare(
          "INSERT INTO captured_webhooks (source,event_id,event_type,payload_json,request_fingerprint,received_at,status) VALUES ('simulated_payments',?,?,?,?,?,'captured') ON CONFLICT(event_id) DO NOTHING",
        )
        .run(
          input.eventId,
          input.eventType,
          input.rawPayload,
          input.requestFingerprint,
          input.receivedAt,
        );
      return {
        created: result.changes === 1,
        webhook: result.changes ? get(Number(result.lastInsertRowid))! : byEvent(input.eventId)!,
      };
    },
    get,
    getByEventId: byEvent,
    setJob(id, jobId) {
      db.prepare('UPDATE captured_webhooks SET job_id=? WHERE id=?').run(jobId, id);
    },
    settle(input) {
      db.prepare(
        'UPDATE captured_webhooks SET status=?, processed_at=?, failure_reason=? WHERE id=?',
      ).run(input.status, input.processedAt, input.failureReason ?? null, input.id);
    },
    list({ status, limit, offset }) {
      const where = status ? 'WHERE status=?' : '';
      const rows = (
        status
          ? db
              .prepare(
                `SELECT * FROM captured_webhooks ${where} ORDER BY received_at DESC,id DESC LIMIT ? OFFSET ?`,
              )
              .all(status, limit, offset)
          : db
              .prepare(
                `SELECT * FROM captured_webhooks ORDER BY received_at DESC,id DESC LIMIT ? OFFSET ?`,
              )
              .all(limit, offset)
      ) as Row[];
      return rows.map(record);
    },
    count(status) {
      return (
        (status
          ? db.prepare('SELECT COUNT(*) AS count FROM captured_webhooks WHERE status=?').get(status)
          : db.prepare('SELECT COUNT(*) AS count FROM captured_webhooks').get()) as {
          count: number;
        }
      ).count;
    },
    findOrderOwner(orderId) {
      const row = db.prepare('SELECT user_id FROM orders WHERE id=?').get(orderId) as
        { user_id: number | null } | undefined;
      return row?.user_id ?? null;
    },
  };
}
