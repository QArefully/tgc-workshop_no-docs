import { createHash, randomBytes } from 'node:crypto';
import type { Country } from '@shop/contracts/country';
import { passwordResetCopy } from '@shop/localisation/messages/asyncContent';
import type { UnitOfWork } from '../../db/unitOfWork.js';
import type { AuditContext } from '../audit/auditEvent.js';
import type { AuditWriter } from '../audit/auditService.js';
import { isValidPassword, normalizeEmail } from '../auth/authRules.js';
import { passwordHasher, type Clock, type PasswordHasher } from '../auth/authService.js';
import type { MailboxRepository } from '../mailbox/mailboxRepository.js';
import type { PasswordResetRepository } from './passwordResetRepository.js';

const RESET_DURATION_MS = 30 * 60 * 1000;

export type PasswordResetResult =
  'SUCCESS' | 'INVALID_TOKEN' | 'EXPIRED' | 'ALREADY_USED' | 'WEAK_PASSWORD';
export type ResetTokenSource = () => string;

export interface PasswordResetService {
  request(email: string, country: Country, context?: AuditContext): void;
  reset(params: {
    token: string;
    newPassword: string;
    requestId?: string;
  }): Promise<PasswordResetResult>;
}

function digestToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function createResetLink(baseUrl: string, token: string): string {
  const link = new URL('/reset-password', baseUrl);
  link.searchParams.set('token', token);
  return link.toString();
}

export function createPasswordResetService(dependencies: {
  repository: PasswordResetRepository;
  mailbox: MailboxRepository;
  clock: Clock;
  baseUrl: string;
  tokenSource?: ResetTokenSource;
  passwords?: PasswordHasher;
  unitOfWork?: UnitOfWork;
  audit?: AuditWriter;
}): PasswordResetService {
  const tokenSource = dependencies.tokenSource ?? (() => randomBytes(32).toString('hex'));
  const passwords = dependencies.passwords ?? passwordHasher;
  new URL(dependencies.baseUrl);

  return {
    request(email, country, context) {
      if (context && context.actor.type !== 'anonymous') {
        throw new Error('Password reset request audit requires an anonymous actor');
      }
      const now = dependencies.clock.now();
      const user = dependencies.repository.findUserByEmail(normalizeEmail(email), country);
      if (!user) return;

      const token = tokenSource();
      const createdAt = now.toISOString();
      const expiresAt = new Date(now.getTime() + RESET_DURATION_MS).toISOString();
      const requestReset = () => {
        dependencies.repository.removeExpired(createdAt);
        dependencies.repository.revokeActiveForUser(user.id);
        dependencies.repository.create({
          userId: user.id,
          tokenDigest: digestToken(token),
          expiresAt,
          createdAt,
        });
        const copy = passwordResetCopy(country, createResetLink(dependencies.baseUrl, token));
        dependencies.mailbox.add({
          recipient: user.email,
          subject: copy.subject,
          body: copy.body,
          kind: 'template',
          templateKey: 'password_reset',
          templateParams: {
            resetUrl: createResetLink(dependencies.baseUrl, token),
          },
          country,
          createdAt,
        });
        if (context) {
          dependencies.audit!.append({
            action: 'auth.password_reset_requested',
            userId: user.id,
            context,
          });
        }
      };
      if (context) {
        if (!dependencies.unitOfWork || !dependencies.audit) {
          throw new Error('Audited password reset requires a unit of work and audit writer');
        }
        dependencies.unitOfWork.run(requestReset);
      } else requestReset();
    },
    async reset({ token, newPassword, requestId }) {
      if (!isValidPassword(newPassword)) return 'WEAK_PASSWORD';
      const tokenDigest = digestToken(token);
      const initial = dependencies.repository.findByDigest(tokenDigest);
      if (!initial) return 'INVALID_TOKEN';
      if (initial.usedAt) return 'ALREADY_USED';
      if (new Date(initial.expiresAt) <= dependencies.clock.now()) return 'EXPIRED';

      const passwordHash = await passwords.hash(newPassword);
      const resetPassword = () => {
        const current = dependencies.repository.findByDigest(tokenDigest);
        if (!current) return 'INVALID_TOKEN';
        if (current.usedAt) return 'ALREADY_USED';
        const now = dependencies.clock.now().toISOString();
        if (new Date(current.expiresAt) <= new Date(now)) return 'EXPIRED';
        if (!dependencies.repository.consume(current.id, now)) return 'ALREADY_USED';

        // The guarded update is the final deletion boundary. It prevents a reset that began
        // before account deletion from restoring credentials after the tombstone commits.
        if (!dependencies.repository.updatePassword(current.userId, passwordHash)) {
          return 'INVALID_TOKEN';
        }
        dependencies.repository.invalidateSessions(current.userId);
        if (requestId !== undefined) {
          if (!dependencies.audit) {
            throw new Error('Audited password reset requires an audit writer');
          }
          dependencies.audit.append({
            action: 'auth.password_reset_completed',
            userId: current.userId,
            context: { actor: { type: 'user', userId: current.userId }, requestId },
          });
        }
        return 'SUCCESS';
      };
      if (requestId !== undefined) {
        if (!dependencies.unitOfWork) {
          throw new Error('Audited password reset requires a unit of work');
        }
        return dependencies.unitOfWork.run(resetPassword);
      }
      return resetPassword();
    },
  };
}
