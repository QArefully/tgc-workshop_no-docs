import type { UnitOfWork } from '../../db/unitOfWork.js';
import { passwordHasher, type Clock, type PasswordHasher } from '../auth/authService.js';
import type { UserCredentials, UserRepository } from '../auth/userRepository.js';
import type { AuditContext } from '../audit/auditEvent.js';
import type { AuditWriter } from '../audit/auditService.js';
import type { AccountDeletionRepository } from './deletionRepository.js';

export type AccountDeletionResult =
  { ok: true } | { ok: false; code: 'INVALID_CURRENT' | 'OWNS_COMPANY' };

export interface AccountDeletionService {
  execute(input: {
    userId: number;
    currentPassword: string;
    context: AuditContext;
  }): Promise<AccountDeletionResult>;
}

export interface AccountDeletionServiceDependencies {
  users: Pick<UserRepository, 'findCredentialsById'>;
  repository: AccountDeletionRepository;
  unitOfWork: UnitOfWork;
  audit: AuditWriter;
  clock: Clock;
  passwords?: PasswordHasher;
}

function storedPassword(user: UserCredentials): string {
  return user.passwordSalt ? `${user.passwordSalt}.${user.passwordHash}` : user.passwordHash;
}

function tombstoneEmail(userId: number): string {
  return `deleted-${userId}@tombstone.local`;
}

/** Password-confirmed, irreversible redaction while preserving all commerce history. */
export function createAccountDeletionService({
  users,
  repository,
  unitOfWork,
  audit,
  clock,
  passwords = passwordHasher,
}: AccountDeletionServiceDependencies): AccountDeletionService {
  return {
    async execute({ userId, currentPassword, context }) {
      if (context.actor.type !== 'user' || context.actor.userId !== userId) {
        throw new Error('Account deletion audit requires the authenticated user as actor');
      }
      const user = users.findCredentialsById(userId);
      if (!user || !(await passwords.verify(currentPassword, storedPassword(user)))) {
        return { ok: false, code: 'INVALID_CURRENT' };
      }

      return unitOfWork.run(() => {
        if (repository.ownsCompanyWithOtherMembers(userId)) {
          return { ok: false, code: 'OWNS_COMPANY' };
        }
        const now = clock.now().toISOString();
        const email = tombstoneEmail(userId);
        const displayName = 'Deleted User';
        repository.retireSoleOwnedCompanies(userId, now);
        repository.retireTradeRecords(userId, now);
        repository.retireMemberships(userId);
        repository.deleteLiveAccountRecords(userId);
        repository.redactUser(userId, email, displayName);
        repository.recordDeletion({
          userId,
          requestedAt: now,
          completedAt: now,
          tombstoneEmail: email,
          tombstoneDisplayName: displayName,
        });
        audit.append({ action: 'auth.account_deleted', userId, context });
        return { ok: true };
      });
    },
  };
}
