import type { AuditWriter, Clock } from '../audit/auditService.js';
import type { Country } from '@shop/contracts/country';
import type { MailboxRepository } from '../mailbox/mailboxRepository.js';
import type { PreferencesService } from '../preferences/preferencesService.js';
import type { FaultSwitch } from '../jobs/faultSwitch.js';
import type { JobHandler } from '../jobs/jobHandlerRegistry.js';
import type { NotificationRepository } from './notificationRepository.js';
import { shouldEmailNotification } from './notificationRules.js';

export interface NotificationDeliveryHandlerDependencies {
  repository: NotificationRepository;
  preferences: PreferencesService;
  mailbox: MailboxRepository;
  audit: AuditWriter;
  clock: Clock;
  faults: FaultSwitch;
  /** Available for country-aware delivery extensions; notification snapshots remain immutable. */
  countryForUser?: (userId: number) => Country | undefined;
}

/** Delivers only the in-app record identified by the queue payload; it never accepts a recipient from a job. */
export function createNotificationDeliveryHandler(
  d: NotificationDeliveryHandlerDependencies,
): JobHandler {
  return ({ payload }) => {
    const notificationId =
      typeof payload === 'object' &&
      payload !== null &&
      typeof (payload as { notificationId?: unknown }).notificationId === 'number'
        ? (payload as { notificationId: number }).notificationId
        : null;
    if (!notificationId) return { ok: false, error: 'Invalid notification delivery payload' };
    if (d.faults.isEnabled('async.notification_delivery_failure'))
      return { ok: false, error: 'Simulated notification delivery failure' };
    const record = d.repository.getDelivery(notificationId);
    if (!record) return { ok: true };
    const context = { actor: { type: 'system' as const, userId: null }, requestId: null };
    if (!shouldEmailNotification(record.notification.kind, d.preferences.get(record.userId))) {
      d.audit.append({ action: 'notification.delivery_skipped', notificationId, context });
      return { ok: true };
    }
    d.mailbox.add({
      recipient: record.recipient,
      subject: record.notification.title,
      body: record.notification.body,
      kind: 'notification',
      createdAt: d.clock.now().toISOString(),
    });
    d.audit.append({ action: 'notification.delivered', notificationId, context });
    return { ok: true };
  };
}
