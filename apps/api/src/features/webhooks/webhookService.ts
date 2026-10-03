/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
import { Value } from '@sinclair/typebox/value';
import {
  PaymentWebhookBody,
  type PaymentWebhookBody as PaymentWebhookBodyType,
} from '@shop/contracts/webhooks';
import type { UnitOfWork } from '../../db/unitOfWork.js';
import type { AuditWriter, Clock } from '../audit/auditService.js';
import type { JobService } from '../jobs/jobService.js';
import type { WebhookRepository } from './webhookRepository.js';
import { verifiesWebhookSignature, webhookFingerprint } from './webhookRules.js';

export class WebhookError extends Error {
  constructor(readonly code: 'INVALID_SIGNATURE' | 'INVALID_PAYLOAD') {
    super(code);
  }
}
export interface WebhookServiceDependencies {
  repository: WebhookRepository;
  jobs: Pick<JobService, 'enqueue'>;
  unitOfWork: UnitOfWork;
  audit: AuditWriter;
  clock: Clock;
  secret: string;
}
export function createWebhookService(d: WebhookServiceDependencies) {
  return {
    capture(input: { rawPayload: string; signature: string; payload?: unknown }) {
      if (!verifiesWebhookSignature(input.rawPayload, input.signature, d.secret))
        throw new WebhookError('INVALID_SIGNATURE');
      let parsed: unknown;
      try {
        parsed = JSON.parse(input.rawPayload);
      } catch {
        throw new WebhookError('INVALID_PAYLOAD');
      }
      if (!Value.Check(PaymentWebhookBody, parsed)) throw new WebhookError('INVALID_PAYLOAD');
      const payload = parsed as PaymentWebhookBodyType;
      return d.unitOfWork.run(() => {
        const captured = d.repository.capture({
          eventId: payload.eventId,
          eventType: payload.eventType,
          payload,
          rawPayload: input.rawPayload,
          requestFingerprint: webhookFingerprint(payload),
          receivedAt: d.clock.now().toISOString(),
        });
        if (!captured.created) return { webhook: captured.webhook, replayed: true };
        const job = d.jobs.enqueue({
          kind: 'webhook.process',
          dedupeKey: `webhook.process:${captured.webhook.id}`,
          payload: { webhookId: captured.webhook.id },
        });
        d.repository.setJob(captured.webhook.id, job.job.id);
        d.audit.append({
          action: 'webhook.captured',
          webhookId: captured.webhook.id,
          context: { actor: { type: 'system', userId: null }, requestId: null },
        });
        return { webhook: { ...captured.webhook, jobId: job.job.id }, replayed: false };
      });
    },
    get: (id: number) => d.repository.get(id),
    list: (
      query: {
        status?: import('./webhookRepository.js').CapturedWebhookStatus;
        page?: number;
        pageSize?: number;
      } = {},
    ) => {
      const page = query.page ?? 1,
        pageSize = query.pageSize ?? 25;
      return {
        items: d.repository.list({
          status: query.status,
          limit: pageSize,
          offset: (page - 1) * pageSize,
        }),
        total: d.repository.count(query.status),
        page,
        pageSize,
      };
    },
  };
}
