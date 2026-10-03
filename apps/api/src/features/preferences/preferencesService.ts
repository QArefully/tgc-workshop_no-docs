import type { UpdatePreferencesBody, UserPreferences } from '@shop/contracts/account-depth';
import type { UnitOfWork } from '../../db/unitOfWork.js';
import type { AuditContext } from '../audit/auditEvent.js';
import type { AuditWriter, Clock } from '../audit/auditService.js';
import { toUserPreferences, type PreferencesRepository } from './preferencesRepository.js';

const DEFAULT_PREFERENCES: UserPreferences = Object.freeze({
  orderUpdatesEmail: true,
  marketingEmail: false,
  approvalRequestEmail: true,
});

export interface PreferencesService {
  /** Returns the published defaults until the buyer saves a preference row. */
  get(userId: number): UserPreferences;
  /** Persists the partial patch and audit entry in one transaction. */
  update(userId: number, patch: UpdatePreferencesBody, context: AuditContext): UserPreferences;
}

export interface PreferencesServiceDependencies {
  repository: PreferencesRepository;
  unitOfWork: UnitOfWork;
  audit: AuditWriter;
  clock: Clock;
}

export function createPreferencesService({
  repository,
  unitOfWork,
  audit,
  clock,
}: PreferencesServiceDependencies): PreferencesService {
  return {
    get(userId) {
      const row = repository.get(userId);
      return row ? toUserPreferences(row) : { ...DEFAULT_PREFERENCES };
    },
    update(userId, patch, context) {
      if (context.actor.type !== 'user' || context.actor.userId !== userId) {
        throw new Error('Preference update audit requires the authenticated user as actor');
      }
      return unitOfWork.run(() => {
        const preferences = toUserPreferences(
          repository.upsert(userId, patch, clock.now().toISOString()),
        );
        audit.append({ action: 'auth.preferences_updated', userId, context });
        return preferences;
      });
    },
  };
}
