import type { UnitOfWork } from '../../db/unitOfWork.js';
import type { AuditContext } from '../audit/auditEvent.js';
import type { AuditWriter } from '../audit/auditService.js';
import type {
  FeatureFlagCreate,
  FeatureFlagRecord,
  FeatureFlagRepository,
  FeatureFlagUpdate,
} from './featureFlagRepository.js';
import type { FeatureFlagResolver } from './featureFlagResolver.js';

const FLAG_KEY_PATTERN = /^[a-z][a-z0-9_.]{1,63}$/;

export class FeatureFlagServiceError extends Error {
  constructor(
    public readonly code: 'DUPLICATE' | 'INVALID_INPUT' | 'NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'FeatureFlagServiceError';
  }
}

export interface FeatureFlagCreateInput {
  key: string;
  description: string;
  enabled: boolean;
}

export interface FeatureFlagPatch {
  description?: string;
  enabled?: boolean;
}

export interface FeatureFlagService {
  list(): FeatureFlagRecord[];
  get(key: string): FeatureFlagRecord;
  create(input: FeatureFlagCreateInput, context: AuditContext): FeatureFlagRecord;
  update(key: string, patch: FeatureFlagPatch, context: AuditContext): FeatureFlagRecord;
  delete(key: string, context: AuditContext): void;
}

function requireKey(value: unknown): string {
  if (typeof value !== 'string' || !FLAG_KEY_PATTERN.test(value)) {
    throw new FeatureFlagServiceError('INVALID_INPUT', 'key must match [a-z][a-z0-9_.]{1,63}');
  }
  return value;
}

function requireDescription(value: unknown): string {
  if (typeof value !== 'string') {
    throw new FeatureFlagServiceError('INVALID_INPUT', 'description must be a string');
  }
  return value.trim();
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new FeatureFlagServiceError('INVALID_INPUT', `${field} must be a boolean`);
  }
  return value;
}

function updatedByUserId(context: AuditContext): number | null {
  return context.actor.type === 'user' ? context.actor.userId : null;
}

function requireFlag(repository: FeatureFlagRepository, key: string): FeatureFlagRecord {
  const flag = repository.get(key);
  if (!flag) throw new FeatureFlagServiceError('NOT_FOUND', 'Feature flag not found');
  return flag;
}

/** Coordinates feature-flag mutations with their immutable audit row. */
export function createFeatureFlagService(dependencies: {
  repository: FeatureFlagRepository;
  resolver: FeatureFlagResolver;
  unitOfWork: UnitOfWork;
  audit: AuditWriter;
}): FeatureFlagService {
  const { repository, resolver, unitOfWork, audit } = dependencies;
  const invalidateAfterCommit = <T>(key: string, work: () => T): T => {
    const result = unitOfWork.run(work);
    resolver.invalidate(key);
    return result;
  };

  return {
    list() {
      return repository.list();
    },
    get(key) {
      return requireFlag(repository, requireKey(key));
    },
    create(input, context) {
      const key = requireKey(input.key);
      const insert: FeatureFlagCreate = {
        key,
        description: requireDescription(input.description),
        enabled: requireBoolean(input.enabled, 'enabled'),
        updatedByUserId: updatedByUserId(context),
      };
      return invalidateAfterCommit(key, () => {
        if (repository.get(key)) {
          throw new FeatureFlagServiceError('DUPLICATE', 'Feature flag key already exists');
        }
        const flag = repository.create(insert);
        audit.append({ action: 'feature_flag.created', context, featureFlagKey: key });
        return flag;
      });
    },
    update(key, patch, context) {
      const flagKey = requireKey(key);
      const update: FeatureFlagUpdate = { updatedByUserId: updatedByUserId(context) };
      if (patch.description !== undefined)
        update.description = requireDescription(patch.description);
      if (patch.enabled !== undefined) update.enabled = requireBoolean(patch.enabled, 'enabled');
      if (update.description === undefined && update.enabled === undefined) {
        throw new FeatureFlagServiceError(
          'INVALID_INPUT',
          'patch must include description or enabled',
        );
      }
      return invalidateAfterCommit(flagKey, () => {
        requireFlag(repository, flagKey);
        const flag = repository.update(flagKey, update);
        if (!flag) throw new FeatureFlagServiceError('NOT_FOUND', 'Feature flag not found');
        audit.append({ action: 'feature_flag.updated', context, featureFlagKey: flagKey });
        return flag;
      });
    },
    delete(key, context) {
      const flagKey = requireKey(key);
      invalidateAfterCommit(flagKey, () => {
        requireFlag(repository, flagKey);
        repository.delete(flagKey);
        audit.append({ action: 'feature_flag.deleted', context, featureFlagKey: flagKey });
      });
    },
  };
}
