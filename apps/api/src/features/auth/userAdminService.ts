import type { PublicUser } from '@shop/contracts/auth';
import type { Country } from '@shop/contracts/country';
import type { UnitOfWork } from '../../db/unitOfWork.js';
import type { AuditContext } from '../audit/auditEvent.js';
import type { AuditWriter } from '../audit/auditService.js';
import { isValidDisplayName, normalizeDisplayName } from './authRules.js';
import type { SessionRepository } from './sessionRepository.js';
import type { AdminUserRecord, UserAdminRepository } from './userAdminRepository.js';

export class UserAdminServiceError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'INVALID_INPUT' | 'LAST_ADMIN',
    message: string,
  ) {
    super(message);
    this.name = 'UserAdminServiceError';
  }
}

export interface UserAdminService {
  list(query?: { search?: string }, country?: Country): AdminUserRecord[];
  get(userId: number, country?: Country): AdminUserRecord;
  updateDisplayName(
    userId: number,
    displayName: string,
    context: AuditContext,
    country?: Country,
  ): AdminUserRecord;
  setRole(
    userId: number,
    role: PublicUser['role'],
    context: AuditContext,
    country?: Country,
  ): AdminUserRecord;
  suspend(
    userId: number,
    reason: string,
    actorId: number,
    context: AuditContext,
    country?: Country,
  ): AdminUserRecord;
  reactivate(
    userId: number,
    actorId: number,
    context: AuditContext,
    country?: Country,
  ): AdminUserRecord;
}

function requireUserId(value: unknown, name = 'userId'): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new UserAdminServiceError('INVALID_INPUT', `${name} must be a positive safe integer`);
  }
  return value as number;
}

function requireRole(value: unknown): PublicUser['role'] {
  if (value !== 'customer' && value !== 'admin') {
    throw new UserAdminServiceError('INVALID_INPUT', 'role must be customer or admin');
  }
  return value;
}

function requireReason(value: unknown): string {
  if (typeof value !== 'string') {
    throw new UserAdminServiceError(
      'INVALID_INPUT',
      'reason must be a non-empty string of at most 500 characters',
    );
  }
  const reason = value.trim();
  if (reason.length < 1 || reason.length > 500) {
    throw new UserAdminServiceError(
      'INVALID_INPUT',
      'reason must be a non-empty string of at most 500 characters',
    );
  }
  return reason;
}

function requireUser(
  repository: UserAdminRepository,
  userId: number,
  country?: Country,
): AdminUserRecord {
  const user = repository.get(userId, country);
  if (!user) throw new UserAdminServiceError('NOT_FOUND', 'User not found');
  return user;
}

export function createUserAdminService(dependencies: {
  repository: UserAdminRepository;
  sessions: SessionRepository;
  unitOfWork: UnitOfWork;
  audit: AuditWriter;
  clock: { now(): Date };
}): UserAdminService {
  const { repository, sessions, unitOfWork, audit, clock } = dependencies;
  return {
    list(query = {}, country) {
      return repository.list(query, country);
    },
    get(userId, country) {
      return requireUser(repository, requireUserId(userId), country);
    },
    updateDisplayName(userId, displayName, context, country) {
      const id = requireUserId(userId);
      if (typeof displayName !== 'string') {
        throw new UserAdminServiceError(
          'INVALID_INPUT',
          'displayName must be between 1 and 80 characters',
        );
      }
      const normalized = normalizeDisplayName(displayName);
      if (!isValidDisplayName(normalized)) {
        throw new UserAdminServiceError(
          'INVALID_INPUT',
          'displayName must be between 1 and 80 characters',
        );
      }
      return unitOfWork.run(() => {
        requireUser(repository, id, country);
        const user = repository.updateDisplayName(id, normalized)!;
        audit.append({ action: 'user.display_name_updated', userId: id, context });
        return user;
      });
    },
    setRole(userId, role, context, country) {
      const id = requireUserId(userId);
      const targetRole = requireRole(role);
      return unitOfWork.run(() => {
        const existing = requireUser(repository, id, country);
        if (
          existing.role === 'admin' &&
          targetRole === 'customer' &&
          existing.suspendedAt === null &&
          repository.countActiveAdmins() <= 1
        ) {
          throw new UserAdminServiceError('LAST_ADMIN', 'At least one active admin is required');
        }
        const user = repository.setRole(id, targetRole)!;
        audit.append({ action: 'user.role_changed', userId: id, context });
        return user;
      });
    },
    suspend(userId, reason, actorId, context, country) {
      const id = requireUserId(userId);
      const actor = requireUserId(actorId, 'actorId');
      const suspensionReason = requireReason(reason);
      return unitOfWork.run(() => {
        const existing = requireUser(repository, id, country);
        if (
          existing.role === 'admin' &&
          existing.suspendedAt === null &&
          repository.countActiveAdmins() <= 1
        ) {
          throw new UserAdminServiceError('LAST_ADMIN', 'At least one active admin is required');
        }
        const user = repository.suspend({
          userId: id,
          reason: suspensionReason,
          suspendedAt: clock.now().toISOString(),
          suspendedByUserId: actor,
        })!;
        sessions.deleteForUser(id);
        audit.append({ action: 'user.suspended', userId: id, context });
        return user;
      });
    },
    reactivate(userId, actorId, context, country) {
      const id = requireUserId(userId);
      requireUserId(actorId, 'actorId');
      return unitOfWork.run(() => {
        requireUser(repository, id, country);
        const user = repository.reactivate(id)!;
        audit.append({ action: 'user.reactivated', userId: id, context });
        return user;
      });
    },
  };
}
