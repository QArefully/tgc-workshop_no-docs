/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unnecessary-type-assertion */
import type {
  StandingOrder,
  StandingOrderCadence,
  StandingOrderLineOutcome,
  StandingOrderRun,
  StandingOrderSource,
} from '@shop/contracts/standing-orders';
import type { Country } from '@shop/contracts/country';
import {
  standingOrderCompletedCopy,
  standingOrderFailedCopy,
} from '@shop/localisation/messages/asyncContent';
import type { AuditContext } from '../audit/auditEvent.js';
import type { AuditWriter, Clock } from '../audit/auditService.js';
import type { CartService } from '../cart/cartService.js';
import type { JobService } from '../jobs/jobService.js';
import type { FaultSwitch } from '../jobs/faultSwitch.js';
import type { NotificationService } from '../notifications/notificationService.js';
import type { OrderService } from '../orders/orderService.js';
import type { ReorderService } from '../reorder/reorderService.js';
import type { SavedListService } from '../savedLists/savedListService.js';
import type { UnitOfWork } from '../../db/unitOfWork.js';
import type {
  StandingOrderRepository,
  StandingOrderRow,
  StandingOrderRunRow,
} from './standingOrderRepository.js';
import {
  standingOrderError,
  standingOrderOk,
  type StandingOrderResult,
} from './standingOrderErrors.js';
import { countOutcomes, nextRunAt, standingOrderDedupeKey } from './standingOrderRules.js';

const systemContext: AuditContext = { actor: { type: 'system', userId: null }, requestId: null };
const map = (row: StandingOrderRow): StandingOrder => ({
  id: String(row.id),
  name: row.name,
  source:
    row.source_kind === 'saved_list'
      ? { kind: 'saved_list', listId: String(row.source_list_id) }
      : { kind: 'order', orderId: String(row.source_order_id) },
  cadence: row.cadence,
  nextRunAt: row.next_run_at,
  lastRunAt: row.last_run_at,
  active: row.active === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const mapRun = (row: StandingOrderRunRow): StandingOrderRun => ({
  id: String(row.id),
  standingOrderId: String(row.standing_order_id),
  jobId: row.job_id === null ? null : String(row.job_id),
  cartId: row.cart_id,
  runAt: row.run_at,
  status: row.status,
  addedLineCount: row.added_line_count,
  skippedLineCount: row.skipped_line_count,
  outcomes:
    row.outcomes_json === null
      ? null
      : (JSON.parse(row.outcomes_json) as StandingOrderLineOutcome[]),
  failureReason: row.failure_reason,
});

export interface StandingOrderServiceDependencies {
  repository: StandingOrderRepository;
  savedLists: Pick<SavedListService, 'get' | 'addToCart'>;
  orders: Pick<OrderService, 'getOwned'>;
  reorder: Pick<ReorderService, 'reorder'>;
  carts: Pick<CartService, 'create'>;
  jobs: Pick<JobService, 'enqueue'>;
  notifications: Pick<NotificationService, 'notify'>;
  audit: AuditWriter;
  unitOfWork: UnitOfWork;
  clock: Clock;
  faults: FaultSwitch;
  /** Persisted account country used for system notification snapshots. */
  countryForUser?: (userId: number) => Country | undefined;
}
export interface StandingOrderService {
  list(userId: number): StandingOrder[];
  listRuns(userId: number, standingOrderId: number): StandingOrderRun[];
  create(
    userId: number,
    input: { name: string; source: StandingOrderSource; cadence: StandingOrderCadence },
    context: AuditContext,
  ): StandingOrderResult<StandingOrder>;
  update(
    userId: number,
    id: number,
    input: { name?: string; cadence?: StandingOrderCadence; active?: boolean },
    context: AuditContext,
  ): StandingOrderResult<StandingOrder>;
  delete(userId: number, id: number, context: AuditContext): StandingOrderResult<null>;
  runNow(
    userId: number,
    standingOrderId: number,
    context: AuditContext,
  ): StandingOrderResult<StandingOrderRun>;
  enqueueDue(now?: Date): number;
  runJob(jobId: number, payload: unknown): { ok: true } | { ok: false; error: string };
}

function sourceExists(
  d: StandingOrderServiceDependencies,
  userId: number,
  s: StandingOrderSource,
): boolean {
  return s.kind === 'saved_list'
    ? d.savedLists.get(userId, Number(s.listId)).ok
    : !!d.orders.getOwned(Number(s.orderId), userId);
}
function outcomesFromSaved(outcomes: any[]): StandingOrderLineOutcome[] {
  return outcomes.map((o) => ({
    orderLineItemId: String(o.itemId),
    productId: o.productId,
    productName: o.productName,
    variantId: o.variantId,
    sku: o.sku,
    configKey: '',
    quantity: o.submittedQuantity ?? o.savedQuantity,
    status: o.status,
    reason: o.reason,
    orderedUnitPriceCents: o.resolvedUnitPriceCents ?? 0,
    currentUnitPriceCents: o.resolvedUnitPriceCents,
    priceChanged: false,
  }));
}

export function createStandingOrderService(
  d: StandingOrderServiceDependencies,
): StandingOrderService {
  const countryForUser = (userId: number): Country => {
    // Direct service fixtures predating country provenance use the legacy UK snapshot. The app
    // composition always supplies the persisted lookup, so live jobs never infer from a request.
    if (!d.countryForUser) return 'UK';
    const country = d.countryForUser?.(userId);
    if (!country) throw new Error('Standing-order owner country is missing');
    return country;
  };
  return {
    list: (userId) => d.repository.listOwned(userId).map(map),
    listRuns: (userId, standingOrderId) =>
      d.repository.listRunsOwned(userId, standingOrderId).map(mapRun),
    create(userId, input, context) {
      return d.unitOfWork.run(() => {
        if (!sourceExists(d, userId, input.source)) return standingOrderError('SOURCE_NOT_FOUND');
        const now = d.clock.now().toISOString();
        const row = d.repository.insert({
          user_id: userId,
          name: input.name.trim(),
          source_kind: input.source.kind,
          source_list_id: input.source.kind === 'saved_list' ? Number(input.source.listId) : null,
          source_order_id: input.source.kind === 'order' ? Number(input.source.orderId) : null,
          cadence: input.cadence,
          next_run_at: nextRunAt(d.clock.now(), input.cadence).toISOString(),
          active: 1,
          created_at: now,
          updated_at: now,
        });
        d.audit.append({ action: 'standing_order.created', standingOrderId: row.id, context });
        return standingOrderOk(map(row));
      });
    },
    update(userId, id, input, context) {
      return d.unitOfWork.run(() => {
        const old = d.repository.findOwned(userId, id);
        if (!old) return standingOrderError('NOT_FOUND');
        d.repository.updateOwned(userId, id, { ...input, now: d.clock.now().toISOString() });
        d.audit.append({ action: 'standing_order.updated', standingOrderId: id, context });
        return standingOrderOk(map(d.repository.findOwned(userId, id)!));
      });
    },
    delete(userId, id, context) {
      return d.unitOfWork.run(() => {
        if (!d.repository.deleteOwned(userId, id)) return standingOrderError('NOT_FOUND');
        d.audit.append({ action: 'standing_order.deleted', standingOrderId: id, context });
        return standingOrderOk(null);
      });
    },
    runNow(userId, standingOrderId, context) {
      return d.unitOfWork.run(() => {
        const row = d.repository.findOwned(userId, standingOrderId);
        if (!row) return standingOrderError('NOT_FOUND');
        if (row.active !== 1) return standingOrderError('INACTIVE');
        const runAt = d.clock.now().toISOString();
        const enqueued = d.jobs.enqueue({
          kind: 'standing_order.run',
          dedupeKey: standingOrderDedupeKey(row.id, runAt),
          payload: { standingOrderId: row.id, scheduledRunAt: runAt },
          runAt,
        });
        const existingRun = d.repository.findRunForJob(enqueued.job.id);
        const run =
          existingRun ??
          d.repository.insertRun({ standingOrderId: row.id, jobId: enqueued.job.id, runAt });
        if (!existingRun) {
          d.audit.append({
            action: 'standing_order.run_started',
            standingOrderId: row.id,
            context,
          });
        }
        return standingOrderOk(mapRun(run));
      });
    },
    enqueueDue(now = d.clock.now()) {
      let count = 0;
      for (const row of d.repository.due(now.toISOString())) {
        const enqueued = d.jobs.enqueue({
          kind: 'standing_order.run',
          dedupeKey: standingOrderDedupeKey(row.id, row.next_run_at),
          payload: { standingOrderId: row.id, scheduledRunAt: row.next_run_at },
          runAt: now.toISOString(),
        });
        if (enqueued.created) count++;
      }
      return count;
    },
    runJob(jobId, payload) {
      return d.unitOfWork.run(() => {
        if (d.faults.isEnabled('async.standing_order_run_failure'))
          return { ok: false as const, error: 'Forced standing-order run failure' };
        const p = payload as { standingOrderId?: number; scheduledRunAt?: string };
        if (!Number.isSafeInteger(p.standingOrderId) || typeof p.scheduledRunAt !== 'string')
          return { ok: false as const, error: 'Invalid standing-order payload' };
        const standingOrderId = p.standingOrderId as number;
        const scheduledRunAt = p.scheduledRunAt as string;
        let run = d.repository.findRunForJob(jobId);
        const row = d.repository.find(standingOrderId);
        if (!row) return { ok: false as const, error: 'Standing order not found' };
        // A completed job may be reclaimed after a worker acknowledgement failure. Its cart and
        // run state are already durable, so acknowledging it is the only safe retry behavior.
        if (run?.status === 'completed') return { ok: true as const };
        // Deactivation can race an enqueued job. Do not create a run record or cart for a
        // schedule which is no longer active.
        if (row.active !== 1) return { ok: true as const };
        if (!run) {
          run = d.repository.insertRun({ standingOrderId: row.id, jobId, runAt: scheduledRunAt });
          d.audit.append({
            action: 'standing_order.run_started',
            standingOrderId: row.id,
            context: systemContext,
          });
        }
        const cartId = d.carts.create(systemContext).cartId;
        const result =
          row.source_kind === 'saved_list'
            ? d.savedLists.addToCart(row.user_id, row.source_list_id!, cartId, systemContext)
            : d.reorder.reorder({
                userId: row.user_id,
                orderId: row.source_order_id!,
                cartId,
                context: systemContext,
              });
        if (!result.ok) {
          const err = result.code;
          d.repository.updateRun({
            id: run.id,
            status: 'failed',
            addedLineCount: 0,
            skippedLineCount: 0,
            failureReason: err,
          });
          d.audit.append({
            action: 'standing_order.run_failed',
            standingOrderId: row.id,
            context: systemContext,
          });
          const copy = standingOrderFailedCopy(countryForUser(row.user_id));
          d.notifications.notify({
            userId: row.user_id,
            kind: 'standing_order.run_failed',
            title: copy.title,
            body: copy.body,
            entityType: 'standing_order_run',
            entityId: String(run.id),
            context: systemContext,
          });
          return { ok: false as const, error: err };
        }
        const outcomes: StandingOrderLineOutcome[] =
          row.source_kind === 'saved_list'
            ? outcomesFromSaved(result.value.outcomes)
            : (result.value.outcomes as StandingOrderLineOutcome[]);
        const counts = countOutcomes(outcomes);
        d.repository.updateRun({ id: run.id, status: 'completed', cartId, outcomes, ...counts });
        d.repository.updateOwned(row.user_id, row.id, {
          nextRunAt: nextRunAt(new Date(scheduledRunAt), row.cadence).toISOString(),
          lastRunAt: d.clock.now().toISOString(),
          now: d.clock.now().toISOString(),
        });
        d.audit.append({
          action: 'standing_order.run_completed',
          standingOrderId: row.id,
          context: systemContext,
        });
        const copy = standingOrderCompletedCopy(countryForUser(row.user_id), counts.addedLineCount);
        d.notifications.notify({
          userId: row.user_id,
          kind: 'standing_order.run_completed',
          title: copy.title,
          body: copy.body,
          entityType: 'standing_order_run',
          entityId: String(run.id),
          context: systemContext,
        });
        return { ok: true as const };
      });
    },
  };
}
