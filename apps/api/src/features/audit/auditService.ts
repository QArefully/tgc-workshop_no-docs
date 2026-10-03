import { buildAuditEvent, type AuditEventInput } from './auditEvent.js';
import type { AuditEventQueryInput } from './auditQuery.js';
import { normalizeAuditEventQuery } from './auditQuery.js';
import type { AuditEventRecord, AuditRepository } from './auditRepository.js';

export interface Clock {
  now(): Date;
}

export interface AuditWriter {
  append(input: AuditEventInput): void;
}

export interface AuditReadService {
  list(query: AuditEventQueryInput): AuditEventPage;
}

export interface AuditEventPage {
  items: AuditEventRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AuditServiceDependencies {
  repository: AuditRepository;
  clock: Clock;
}

/** Writes audit rows without owning transaction boundaries. */
export function createAuditWriter(dependencies: AuditServiceDependencies): AuditWriter {
  return {
    append(input) {
      dependencies.repository.append({
        ...buildAuditEvent(input),
        occurredAt: dependencies.clock.now().toISOString(),
      });
    },
  };
}

export function createAuditReadService(repository: AuditRepository): AuditReadService {
  return {
    list(input) {
      const query = normalizeAuditEventQuery(input);
      return {
        items: repository.list(query),
        total: repository.count(query),
        page: query.page,
        pageSize: query.pageSize,
      };
    },
  };
}
