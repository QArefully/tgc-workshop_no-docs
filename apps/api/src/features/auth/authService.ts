import type { PublicUser } from '@shop/contracts/auth';
import type { Country } from '@shop/contracts/country';
import { SUPPORTED_COUNTRIES } from '@shop/contracts/country';
import type { UnitOfWork } from '../../db/unitOfWork.js';
import type { AuditContext } from '../audit/auditEvent.js';
import type { AuditWriter } from '../audit/auditService.js';
import { hashPassword, verifyPassword } from '../../utils/passwords.js';
import {
  isValidDisplayName,
  isValidEmail,
  isValidPassword,
  normalizeDisplayName,
  normalizeEmail,
} from './authRules.js';
import type { UserCredentials, UserRecord, UserRepository } from './userRepository.js';

export interface Clock {
  now(): Date;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, stored: string): Promise<boolean>;
}

export const passwordHasher: PasswordHasher = { hash: hashPassword, verify: verifyPassword };

export interface AuthService {
  signup(params: {
    email: string;
    password: string;
    displayName: string;
    country: Country;
    auditContext?: AuditContext;
  }): Promise<SignupResult>;
  login(params: { email: string; password: string; country: Country }): Promise<LoginResult>;
  changePassword(params: {
    userId: number;
    currentPassword: string;
    newPassword: string;
    invalidateOtherSessions: () => void;
    auditContext?: AuditContext;
  }): Promise<ChangePasswordResult>;
}

export type SignupResult =
  | { ok: true; userId: number; user: PublicUser }
  | {
      ok: false;
      error: 'EMAIL_EXISTS' | 'WEAK_PASSWORD' | 'INVALID_DISPLAY_NAME' | 'INVALID_EMAIL';
    };
export type LoginResult =
  { ok: true; userId: number; user: PublicUser } | { ok: false; error?: 'AUTH_SUSPENDED' };
export type ChangePasswordResult =
  'SUCCESS' | 'INVALID_CURRENT' | 'SAME_PASSWORD' | 'WEAK_PASSWORD';

export function toPublicUser(user: UserRecord): PublicUser {
  const country = user.country;
  if (!(SUPPORTED_COUNTRIES as readonly string[]).includes(country)) {
    throw new Error(`Unexpected user country: ${country}`);
  }
  return {
    id: String(user.id),
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    country: country as PublicUser['country'],
  };
}

function storedPassword(user: UserCredentials): string {
  return user.passwordSalt ? `${user.passwordSalt}.${user.passwordHash}` : user.passwordHash;
}

/** Account deletion clears both credential fields; never let a tolerant password adapter revive it. */
function hasLiveCredentials(user: UserCredentials): boolean {
  return user.passwordHash !== '' || user.passwordSalt !== '';
}

function isUniqueEmailError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (('code' in error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') ||
      /UNIQUE constraint failed: users\.email/.test(error.message))
  );
}

export function createAuthService(dependencies: {
  users: UserRepository;
  clock: Clock;
  passwords?: PasswordHasher;
  unitOfWork?: UnitOfWork;
  audit?: AuditWriter;
}): AuthService {
  const passwords = dependencies.passwords ?? passwordHasher;
  const runAudited = <T>(work: () => T): T => {
    if (!dependencies.unitOfWork || !dependencies.audit) {
      throw new Error('Audited auth mutations require a unit of work and audit writer');
    }
    return dependencies.unitOfWork.run(work);
  };
  return {
    async signup({
      email: providedEmail,
      password,
      displayName: providedDisplayName,
      country,
      auditContext,
    }) {
      if (auditContext && auditContext.actor.type !== 'anonymous') {
        throw new Error('Signup audit requires an anonymous actor');
      }
      const email = normalizeEmail(providedEmail);
      const displayName = normalizeDisplayName(providedDisplayName);
      if (!isValidEmail(email)) return { ok: false, error: 'INVALID_EMAIL' };
      if (!isValidDisplayName(displayName)) return { ok: false, error: 'INVALID_DISPLAY_NAME' };
      if (!isValidPassword(password)) return { ok: false, error: 'WEAK_PASSWORD' };

      const passwordHash = await passwords.hash(password);
      try {
        const create = () => {
          const user = dependencies.users.create({
            email,
            displayName,
            country,
            passwordHash,
            now: dependencies.clock.now().toISOString(),
          });
          if (auditContext) {
            dependencies.audit!.append({
              action: 'auth.user_signed_up',
              userId: user.id,
              context: auditContext,
            });
          }
          return user;
        };
        const user = auditContext ? runAudited(create) : create();
        return { ok: true, userId: user.id, user: toPublicUser(user) };
      } catch (error) {
        if (isUniqueEmailError(error)) return { ok: false, error: 'EMAIL_EXISTS' };
        throw error;
      }
    },
    async login({ email: providedEmail, password, country }) {
      const user = dependencies.users.findCredentialsByEmail(
        normalizeEmail(providedEmail),
        country,
      );
      if (
        !user ||
        !hasLiveCredentials(user) ||
        !(await passwords.verify(password, storedPassword(user)))
      )
        return { ok: false };
      if (user.suspendedAt !== null) return { ok: false, error: 'AUTH_SUSPENDED' };
      return { ok: true, userId: user.id, user: toPublicUser(user) };
    },
    async changePassword({
      userId,
      currentPassword,
      newPassword,
      invalidateOtherSessions,
      auditContext,
    }) {
      if (
        auditContext &&
        (auditContext.actor.type !== 'user' || auditContext.actor.userId !== userId)
      ) {
        throw new Error('Password change audit requires the changed user as actor');
      }
      if (!isValidPassword(newPassword)) return 'WEAK_PASSWORD';
      const user = dependencies.users.findCredentialsById(userId);
      if (
        !user ||
        !hasLiveCredentials(user) ||
        !(await passwords.verify(currentPassword, storedPassword(user)))
      )
        return 'INVALID_CURRENT';
      if (currentPassword === newPassword) return 'SAME_PASSWORD';
      const passwordHash = await passwords.hash(newPassword);
      const change = () => {
        dependencies.users.updatePassword(userId, passwordHash);
        invalidateOtherSessions();
        if (auditContext) {
          dependencies.audit!.append({
            action: 'auth.password_changed',
            userId,
            context: auditContext,
          });
        }
      };
      if (auditContext) runAudited(change);
      else change();
      return 'SUCCESS';
    },
  };
}
