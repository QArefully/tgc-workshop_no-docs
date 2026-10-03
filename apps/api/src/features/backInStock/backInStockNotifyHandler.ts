import type { UnitOfWork } from '../../db/unitOfWork.js';
import type { AuditWriter, Clock } from '../audit/auditService.js';
import type { InventoryService } from '../inventory/inventoryService.js';
import type { FaultSwitch } from '../jobs/faultSwitch.js';
import type { JobHandler } from '../jobs/jobHandlerRegistry.js';
import type { NotificationService } from '../notifications/notificationService.js';
import type { CountryProfileService } from '../countryProfile/countryProfileService.js';
import { backInStockCopy } from '@shop/localisation/messages/asyncContent';
import { minimumOrderQuantity } from '../pricing/pricingRules.js';
import type { BackInStockRepository } from './backInStockRepository.js';
import { isNotifiable } from './backInStockRules.js';
import type { BackInStockNotifyPayload } from './backInStockTrigger.js';

export interface BackInStockNotifyHandlerDependencies {
  repository: Pick<
    BackInStockRepository,
    | 'listPendingForVariant'
    | 'markNotified'
    | 'markCancelled'
    | 'variantFacts'
    | 'findOwned'
    | 'userCountry'
  >;
  notifications: Pick<NotificationService, 'notify'>;
  inventory: Pick<InventoryService, 'availableToSell'>;
  unitOfWork: UnitOfWork;
  audit: AuditWriter;
  clock: Clock;
  faults: FaultSwitch;
  countryProfiles?: Pick<CountryProfileService, 'isCategoryBlocked' | 'isProductBlocked'>;
}

/** Every fan-out row is written by the system, never by the buyer whose interest it settles. */
const systemContext = { actor: { type: 'system' as const, userId: null }, requestId: null };

function payloadVariantId(payload: unknown): number | null {
  const candidate = (payload as Partial<BackInStockNotifyPayload> | null | undefined)?.variantId;
  return Number.isSafeInteger(candidate) && (candidate as number) > 0
    ? (candidate as number)
    : null;
}

/**
 * Settles pending back-in-stock interest for one variant.
 *
 * Each subscription is settled in its own transaction so a mid-fan-out failure resumes from the
 * first still-pending row instead of restarting or double-notifying. Expected domain states
 * (missing variant, retired lot, stock still below MOQ, nothing pending) are successes: the queue
 * must not retry a job whose work is genuinely done.
 */
export function createBackInStockNotifyHandler(
  d: BackInStockNotifyHandlerDependencies,
): JobHandler {
  return ({ payload }) => {
    const variantId = payloadVariantId(payload);
    if (variantId === null) return { ok: false, error: 'Invalid back-in-stock notify payload' };
    if (d.faults.isEnabled('async.back_in_stock_failure'))
      return { ok: false, error: 'Simulated back-in-stock notify failure' };

    const pending = d.repository.listPendingForVariant(variantId);
    if (pending.length === 0) return { ok: true };

    const settleCancellation = (row: (typeof pending)[number]): boolean => {
      const current = d.repository.findOwned(row.id, row.user_id);
      if (current?.status !== 'pending') return true;
      const currentFacts = d.repository.variantFacts(variantId);
      const subscriberCountry = d.repository.userCountry(row.user_id);
      const remainsOrderable =
        currentFacts?.active === 1 &&
        subscriberCountry !== undefined &&
        !d.countryProfiles?.isCategoryBlocked(subscriberCountry, currentFacts.product_category) &&
        !d.countryProfiles?.isProductBlocked(subscriberCountry, currentFacts.product_slug);
      if (remainsOrderable) return false;
      d.repository.markCancelled(row.id, d.clock.now().toISOString());
      d.audit.append({
        action: 'back_in_stock.cancelled',
        subscriptionId: row.id,
        context: systemContext,
      });
      return true;
    };

    // Country blocks and terminal lot states settle independently of stock. Each subscriber's
    // persisted country and the current lot facts are read inside that row's transaction.
    for (const row of pending) d.unitOfWork.run(() => settleCancellation(row));

    const facts = d.repository.variantFacts(variantId);
    if (!facts || facts.active !== 1) return { ok: true };

    const minimum = minimumOrderQuantity(facts.weight_grams, facts.moq_sacks);
    // An unusable weight/MOQ basis leaves nothing a buyer could order; wait for a later movement.
    if (minimum === undefined) return { ok: true };
    const at = d.clock.now().toISOString();
    const availableToSell =
      d.inventory.availableToSell([variantId], at).find((e) => e.variantId === variantId)
        ?.availableToSell ?? 0;
    // Below the MOQ floor the lot is not orderable, so pending interest stays pending.
    if (!isNotifiable(availableToSell, minimum)) return { ok: true };

    for (const row of pending) {
      d.unitOfWork.run(() => {
        // Re-read inside the transaction: a buyer may have cancelled since the list was taken.
        if (settleCancellation(row)) return;
        const country = d.repository.userCountry(row.user_id);
        if (!country) throw new Error('Back-in-stock subscriber country is missing');
        const copy = backInStockCopy(country, facts.product_name, facts.label);
        const notified = d.notifications.notify({
          userId: row.user_id,
          kind: 'back_in_stock.available',
          title: copy.title,
          body: copy.body,
          // Subscription-scoped identity keeps a later re-subscription independently notifiable.
          entityType: 'back_in_stock_subscription',
          entityId: String(row.id),
          context: systemContext,
        });
        const now = d.clock.now().toISOString();
        d.repository.markNotified(row.id, Number(notified.notification.id), now);
        d.audit.append({
          action: 'back_in_stock.notified',
          subscriptionId: row.id,
          context: systemContext,
        });
      });
    }
    return { ok: true };
  };
}
