import type { UnitOfWork } from '../../db/unitOfWork.js';
import type { Clock } from '../audit/auditService.js';
import type { JobService } from '../jobs/jobService.js';
import type { StockChangeObserver } from '../inventory/stockObserver.js';
import { backInStockJobDedupeKey } from './backInStockRules.js';
import type { BackInStockRepository } from './backInStockRepository.js';

export interface BackInStockTriggerDependencies {
  repository: Pick<BackInStockRepository, 'hasPendingForVariant'>;
  jobs: Pick<JobService, 'enqueue'>;
  unitOfWork: UnitOfWork;
  clock: Clock;
}

/** Payload handed to the `back_in_stock.notify` handler; the handler re-reads current state. */
export interface BackInStockNotifyPayload {
  variantId: number;
}

/**
 * Turns a stock movement into at most one queued notify job.
 *
 * Deliberately never reads availability: whether the lot is *actually* orderable is a decision
 * the job handler must make against committed state at run time, not one the trigger can make
 * from inside the movement's own transaction.
 */
export function createBackInStockTrigger(
  dependencies: BackInStockTriggerDependencies,
): StockChangeObserver {
  return {
    stockChanged(variantId, occurredAt) {
      dependencies.unitOfWork.run(() => {
        if (!dependencies.repository.hasPendingForVariant(variantId)) return;
        dependencies.jobs.enqueue({
          kind: 'back_in_stock.notify',
          dedupeKey: backInStockJobDedupeKey(variantId, occurredAt),
          payload: { variantId } satisfies BackInStockNotifyPayload,
          runAt: dependencies.clock.now().toISOString(),
        });
      });
    },
  };
}
