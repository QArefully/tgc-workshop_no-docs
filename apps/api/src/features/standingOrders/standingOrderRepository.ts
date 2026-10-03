import type Database from 'better-sqlite3';
import type {
  StandingOrderCadence,
  StandingOrderLineOutcome,
} from '@shop/contracts/standing-orders';

export interface StandingOrderRow {
  id: number;
  user_id: number;
  name: string;
  source_kind: 'saved_list' | 'order';
  source_list_id: number | null;
  source_order_id: number | null;
  cadence: StandingOrderCadence;
  next_run_at: string;
  last_run_at: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}
export interface StandingOrderRunRow {
  id: number;
  standing_order_id: number;
  job_id: number | null;
  cart_id: string | null;
  run_at: string;
  status: 'pending' | 'completed' | 'failed';
  added_line_count: number;
  skipped_line_count: number;
  outcomes_json: string | null;
  failure_reason: string | null;
}
export interface StandingOrderRepository {
  listOwned(userId: number): StandingOrderRow[];
  findOwned(userId: number, id: number): StandingOrderRow | undefined;
  find(id: number): StandingOrderRow | undefined;
  insert(i: Omit<StandingOrderRow, 'id' | 'last_run_at'>): StandingOrderRow;
  updateOwned(
    userId: number,
    id: number,
    patch: {
      name?: string;
      cadence?: StandingOrderCadence;
      active?: boolean;
      nextRunAt?: string;
      lastRunAt?: string;
      now: string;
    },
  ): boolean;
  deleteOwned(userId: number, id: number): boolean;
  due(now: string): StandingOrderRow[];
  listRunsOwned(userId: number, standingOrderId: number): StandingOrderRunRow[];
  insertRun(i: {
    standingOrderId: number;
    jobId: number | null;
    runAt: string;
  }): StandingOrderRunRow;
  findRunForJob(jobId: number): StandingOrderRunRow | undefined;
  updateRun(i: {
    id: number;
    status: 'completed' | 'failed';
    cartId?: string | null;
    outcomes?: StandingOrderLineOutcome[];
    addedLineCount: number;
    skippedLineCount: number;
    failureReason?: string | null;
  }): void;
}
export function createStandingOrderRepository(db: Database.Database): StandingOrderRepository {
  const cols =
    'id,user_id,name,source_kind,source_list_id,source_order_id,cadence,next_run_at,last_run_at,active,created_at,updated_at';
  return {
    listOwned: (u) =>
      db
        .prepare(`SELECT ${cols} FROM standing_orders WHERE user_id=? ORDER BY id`)
        .all(u) as StandingOrderRow[],
    findOwned: (u, id) =>
      db.prepare(`SELECT ${cols} FROM standing_orders WHERE user_id=? AND id=?`).get(u, id) as
        StandingOrderRow | undefined,
    find: (id) =>
      db.prepare(`SELECT ${cols} FROM standing_orders WHERE id=?`).get(id) as
        StandingOrderRow | undefined,
    insert: (i) => {
      const r = db
        .prepare(
          'INSERT INTO standing_orders (user_id,name,source_kind,source_list_id,source_order_id,cadence,next_run_at,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          i.user_id,
          i.name,
          i.source_kind,
          i.source_list_id,
          i.source_order_id,
          i.cadence,
          i.next_run_at,
          i.active,
          i.created_at,
          i.updated_at,
        );
      return db
        .prepare(`SELECT ${cols} FROM standing_orders WHERE id=?`)
        .get(Number(r.lastInsertRowid)) as StandingOrderRow;
    },
    updateOwned: (u, id, p) =>
      db
        .prepare(
          `UPDATE standing_orders SET name=COALESCE(?,name),cadence=COALESCE(?,cadence),active=COALESCE(?,active),next_run_at=COALESCE(?,next_run_at),last_run_at=COALESCE(?,last_run_at),updated_at=? WHERE user_id=? AND id=?`,
        )
        .run(
          p.name ?? null,
          p.cadence ?? null,
          p.active === undefined ? null : p.active ? 1 : 0,
          p.nextRunAt ?? null,
          p.lastRunAt ?? null,
          p.now,
          u,
          id,
        ).changes > 0,
    deleteOwned: (u, id) =>
      db.prepare('DELETE FROM standing_orders WHERE user_id=? AND id=?').run(u, id).changes > 0,
    due: (n) =>
      db
        .prepare(
          `SELECT ${cols} FROM standing_orders WHERE active=1 AND next_run_at<=? ORDER BY next_run_at,id`,
        )
        .all(n) as StandingOrderRow[],
    listRunsOwned: (userId, standingOrderId) =>
      db
        .prepare(
          `SELECT r.*
           FROM standing_order_runs r
           JOIN standing_orders s ON s.id = r.standing_order_id
           WHERE s.user_id=? AND r.standing_order_id=?
           ORDER BY r.run_at DESC,r.id DESC`,
        )
        .all(userId, standingOrderId) as StandingOrderRunRow[],
    insertRun: (i) => {
      const r = db
        .prepare(
          "INSERT INTO standing_order_runs (standing_order_id,job_id,run_at,status) VALUES (?,?,?,'pending')",
        )
        .run(i.standingOrderId, i.jobId, i.runAt);
      return db
        .prepare('SELECT * FROM standing_order_runs WHERE id=?')
        .get(Number(r.lastInsertRowid)) as StandingOrderRunRow;
    },
    findRunForJob: (j) =>
      db.prepare('SELECT * FROM standing_order_runs WHERE job_id=?').get(j) as
        StandingOrderRunRow | undefined,
    updateRun: (i) => {
      db.prepare(
        'UPDATE standing_order_runs SET status=?,cart_id=?,outcomes_json=?,added_line_count=?,skipped_line_count=?,failure_reason=? WHERE id=?',
      ).run(
        i.status,
        i.cartId ?? null,
        i.outcomes ? JSON.stringify(i.outcomes) : null,
        i.addedLineCount,
        i.skippedLineCount,
        i.failureReason ?? null,
        i.id,
      );
    },
  };
}
