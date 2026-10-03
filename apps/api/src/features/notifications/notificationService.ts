import type {
  Notification,
  NotificationKind,
  NotificationPage,
  NotificationReadStatus,
} from '@shop/contracts/notifications';
import type { UnitOfWork } from '../../db/unitOfWork.js';
import type { AuditContext } from '../audit/auditEvent.js';
import type { AuditWriter, Clock } from '../audit/auditService.js';
import type { JobService } from '../jobs/jobService.js';
import { notificationDedupeKey } from './notificationRules.js';
import {
  notificationError,
  notificationOk,
  type NotificationResult,
} from './notificationErrors.js';
import type { NotificationRepository } from './notificationRepository.js';

export interface NotificationService {
  notify(input: {
    userId: number;
    kind: NotificationKind;
    title: string;
    body: string;
    entityType?: string | null;
    entityId?: string | null;
    context: AuditContext;
  }): { created: boolean; notification: Notification };
  list(
    userId: number,
    query?: { status?: NotificationReadStatus; page?: number; pageSize?: number },
  ): NotificationPage;
  markRead(
    userId: number,
    notificationId: number,
    context: AuditContext,
  ): NotificationResult<Notification>;
  markAllRead(userId: number, context: AuditContext): { affectedCount: number };
}
export interface NotificationServiceDependencies {
  repository: NotificationRepository;
  jobs: Pick<JobService, 'enqueue'>;
  unitOfWork: UnitOfWork;
  audit: AuditWriter;
  clock: Clock;
}

export function createNotificationService(d: NotificationServiceDependencies): NotificationService {
  return {
    notify(input) {
      return d.unitOfWork.run(() => {
        const entityType = input.entityType ?? null;
        const entityId = input.entityId ?? null;
        const inserted = d.repository.insertIfAbsent({
          ...input,
          entityType,
          entityId,
          dedupeKey: notificationDedupeKey(input.userId, input.kind, entityType, entityId),
          createdAt: d.clock.now().toISOString(),
        });
        if (inserted.created) {
          d.jobs.enqueue({
            kind: 'notification.deliver',
            dedupeKey: `notification.deliver:${inserted.notification.id}`,
            payload: { notificationId: Number(inserted.notification.id) },
          });
          d.audit.append({
            action: 'notification.created',
            notificationId: Number(inserted.notification.id),
            context: input.context,
          });
        }
        return inserted;
      });
    },
    list(userId, query = {}) {
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 25;
      return {
        items: d.repository.listOwned({
          userId,
          status: query.status,
          limit: pageSize,
          offset: (page - 1) * pageSize,
        }),
        total: d.repository.countOwned(userId, query.status),
        unreadTotal: d.repository.countOwned(userId, 'unread'),
        page,
        pageSize,
      };
    },
    markRead(userId, notificationId, context) {
      return d.unitOfWork.run(() => {
        const existing = d.repository.get(notificationId);
        if (!existing) return notificationError<Notification>('NOT_FOUND');
        if (existing.userId !== userId) return notificationError<Notification>('FORBIDDEN');
        if (d.repository.markRead(userId, notificationId, d.clock.now().toISOString()))
          d.audit.append({ action: 'notification.read', notificationId, context });
        return notificationOk(d.repository.getOwned(userId, notificationId)!);
      });
    },
    markAllRead(userId, context) {
      return d.unitOfWork.run(() => {
        const ids = d.repository.markAllRead(userId, d.clock.now().toISOString());
        for (const notificationId of ids)
          d.audit.append({ action: 'notification.read', notificationId, context });
        return { affectedCount: ids.length };
      });
    },
  };
}
