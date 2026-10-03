import type { AuditWriter, Clock } from '../audit/auditService.js';
import type { Country } from '@shop/contracts/country';
import { paymentSettledCopy } from '@shop/localisation/messages/asyncContent';
import type { FaultSwitch } from '../jobs/faultSwitch.js';
import type { JobHandler } from '../jobs/jobHandlerRegistry.js';
import type { NotificationService } from '../notifications/notificationService.js';
import type { PaymentRepository } from '../payments/paymentRepository.js';
import type { WebhookRepository } from './webhookRepository.js';
import { paymentTransitionForWebhook } from './webhookRules.js';

export interface WebhookProcessingHandlerDependencies {
  repository: WebhookRepository;
  payments: PaymentRepository;
  notifications: Pick<NotificationService, 'notify'>;
  audit: AuditWriter;
  clock: Clock;
  faults: FaultSwitch;
  /** User-account country is authoritative for recipient snapshots. */
  countryForUser?: (userId: number) => Country | undefined;
}
export function createWebhookProcessingHandler(
  d: WebhookProcessingHandlerDependencies,
): JobHandler {
  return ({ payload }) => {
    const webhookId =
      typeof payload === 'object' &&
      payload !== null &&
      typeof (payload as { webhookId?: unknown }).webhookId === 'number'
        ? (payload as { webhookId: number }).webhookId
        : null;
    if (!webhookId) return { ok: false, error: 'Invalid webhook processing payload' };
    if (d.faults.isEnabled('async.webhook_processing_failure'))
      return { ok: false, error: 'Simulated webhook processing failure' };
    const webhook = d.repository.get(webhookId);
    if (!webhook) return { ok: true };
    const payment = d.payments.load(webhook.payload.idempotencyKey);
    const now = d.clock.now().toISOString();
    if (!payment) {
      d.repository.settle({
        id: webhook.id,
        status: 'rejected',
        processedAt: now,
        failureReason: 'Unknown payment',
      });
      d.audit.append({
        action: 'webhook.rejected',
        webhookId: webhook.id,
        context: { actor: { type: 'system', userId: null }, requestId: null },
      });
      return { ok: true };
    }
    const transition = paymentTransitionForWebhook(webhook.eventType);
    if (!transition) {
      d.repository.settle({
        id: webhook.id,
        status: 'rejected',
        processedAt: now,
        failureReason: 'Unsupported webhook event type',
      });
      d.audit.append({
        action: 'webhook.rejected',
        webhookId: webhook.id,
        context: { actor: { type: 'system', userId: null }, requestId: null },
      });
      return { ok: true };
    }
    if (
      !d.payments.transition({
        ...transition,
        idempotencyKey: payment.idempotencyKey,
        updatedAt: now,
      })
    ) {
      d.repository.settle({
        id: webhook.id,
        status: 'ignored_stale',
        processedAt: now,
        failureReason: 'Payment state no longer accepts event',
      });
      d.audit.append({
        action: 'webhook.ignored_stale',
        webhookId: webhook.id,
        context: { actor: { type: 'system', userId: null }, requestId: null },
      });
      return { ok: true };
    }
    d.repository.settle({ id: webhook.id, status: 'processed', processedAt: now });
    d.audit.append({
      action: 'webhook.processed',
      webhookId: webhook.id,
      context: { actor: { type: 'system', userId: null }, requestId: null },
    });
    if (webhook.eventType === 'payment.succeeded' && payment.orderId !== null) {
      const owner = d.repository.findOrderOwner(payment.orderId);
      if (owner !== null) {
        // Production composition always supplies the persisted user-country lookup. Keep the
        // legacy direct-handler fixture deterministic while callers migrate to that dependency.
        const country = d.countryForUser?.(owner) ?? 'UK';
        const copy = paymentSettledCopy(country, payment.orderId);
        d.notifications.notify({
          userId: owner,
          kind: 'payment.webhook_settled',
          title: copy.title,
          body: copy.body,
          entityType: 'order',
          entityId: String(payment.orderId),
          context: { actor: { type: 'system', userId: null }, requestId: null },
        });
      }
    }
    return { ok: true };
  };
}
