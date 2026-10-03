import { randomBytes } from 'node:crypto';
import type { UnitOfWork } from '../../db/unitOfWork.js';
import type { AuditContext } from '../audit/auditEvent.js';
import type { AuditWriter } from '../audit/auditService.js';
import type { Clock } from './authService.js';
import type { SessionRecord, SessionRepository, SessionUser } from './sessionRepository.js';
import type { SessionSummary } from '@shop/contracts/account-depth';

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const LAST_SEEN_UPDATE_INTERVAL_MS = 60 * 1000;
const MAX_SESSION_TOKEN_ATTEMPTS = 10;

export type SessionTokenSource = () => string;
export interface SessionAuditDetails {
  context: AuditContext;
  source: 'signup' | 'login';
}

export interface SessionService {
  create(userId: number, audit?: SessionAuditDetails): { token: string; expiresAt: Date } | null;
  destroy(token: string, context?: AuditContext): boolean;
  getUser(token: string): SessionUser | null;
  listForUser(userId: number, currentToken: string): SessionSummary[];
  revokeForUser(
    userId: number,
    sessionShortId: string,
    currentToken: string,
    context: AuditContext,
  ): SessionRevokeResult;
  updateLastSeen(token: string): void;
  invalidateAllForUser(userId: number): void;
  invalidateOtherForUser(userId: number, token: string): void;
}

export type SessionRevokeResult =
  { ok: true } | { ok: false; code: 'CANNOT_REVOKE_CURRENT' | 'SESSION_NOT_FOUND' };

/** Maps a secret token to the stable, display-safe identifier accepted by account-session routes. */
export function toSessionShortId(token: string): string {
  return token.slice(0, 12);
}

/** SQLite's legacy `datetime('now')` values are UTC but omit milliseconds and the `Z` suffix. */
function toUtcIsoInstant(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return value;
  const sqliteUtc = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(value);
  if (sqliteUtc) return `${sqliteUtc[1]}T${sqliteUtc[2]}.000Z`;
  return new Date(value).toISOString();
}

function toSummary(session: SessionRecord, currentToken: string): SessionSummary {
  return {
    sessionId: toSessionShortId(session.token),
    createdAt: toUtcIsoInstant(session.createdAt),
    expiresAt: toUtcIsoInstant(session.expiresAt),
    lastSeenAt: session.lastSeenAt === null ? null : toUtcIsoInstant(session.lastSeenAt),
    userAgent: session.userAgent,
    ipAddressHash: session.ipAddressHash,
    isCurrent: session.token === currentToken,
  };
}

export function createSessionService(dependencies: {
  sessions: SessionRepository;
  clock: Clock;
  tokenSource?: SessionTokenSource;
  unitOfWork?: UnitOfWork;
  audit?: AuditWriter;
}): SessionService {
  const tokenSource = dependencies.tokenSource ?? (() => randomBytes(32).toString('hex'));
  const runAudited = (work: () => void): void => {
    if (!dependencies.unitOfWork || !dependencies.audit) {
      throw new Error('Audited session mutations require a unit of work and audit writer');
    }
    dependencies.unitOfWork.run(work);
  };
  return {
    create(userId, audit) {
      if (audit && (audit.context.actor.type !== 'user' || audit.context.actor.userId !== userId)) {
        throw new Error('Session creation audit requires the created user as actor');
      }
      const now = dependencies.clock.now();
      let token: string | null = null;
      for (let attempt = 0; attempt < MAX_SESSION_TOKEN_ATTEMPTS; attempt += 1) {
        const candidate = tokenSource();
        if (!dependencies.sessions.findByShortId(toSessionShortId(candidate))) {
          token = candidate;
          break;
        }
      }
      if (!token) throw new Error('Unable to generate a unique session identifier');
      const sessionToken = token;
      const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);
      let created = false;
      const create = () => {
        created = dependencies.sessions.create({
          token: sessionToken,
          userId,
          createdAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
          lastSeenAt: now.toISOString(),
          userAgent: null,
          ipAddressHash: null,
        });
        if (created && audit)
          dependencies.audit!.append({
            action: 'auth.session_created',
            userId,
            source: audit.source,
            context: audit.context,
          });
      };
      if (audit) runAudited(create);
      else create();
      return created ? { token: sessionToken, expiresAt } : null;
    },
    destroy(token, context) {
      let destroyed = false;
      if (context && context.actor.type !== 'user') {
        throw new Error('Session destruction audit requires a user actor');
      }
      const actorUserId = context?.actor.type === 'user' ? context.actor.userId : null;
      const destroy = () => {
        destroyed = dependencies.sessions.delete(token);
        if (destroyed && context) {
          dependencies.audit!.append({
            action: 'auth.session_destroyed',
            userId: actorUserId!,
            context,
          });
        }
      };
      if (context) runAudited(destroy);
      else destroy();
      return destroyed;
    },
    getUser(token) {
      const session = dependencies.sessions.findUser(token);
      if (!session) return null;
      if (new Date(session.expiresAt) <= dependencies.clock.now()) {
        dependencies.sessions.delete(token);
        return null;
      }
      return session.user;
    },
    listForUser(userId, currentToken) {
      const now = dependencies.clock.now().toISOString();
      return dependencies.sessions
        .listByUser(userId)
        .filter((session) => session.expiresAt > now)
        .map((session) => toSummary(session, currentToken));
    },
    revokeForUser(userId, sessionShortId, currentToken, context) {
      if (context.actor.type !== 'user' || context.actor.userId !== userId) {
        throw new Error('Session revocation audit requires the authenticated user as actor');
      }
      if (toSessionShortId(currentToken) === sessionShortId) {
        return { ok: false, code: 'CANNOT_REVOKE_CURRENT' };
      }
      let revoked = false;
      runAudited(() => {
        revoked = dependencies.sessions.deleteByIdForUser(userId, sessionShortId);
        if (revoked) {
          dependencies.audit!.append({ action: 'auth.session_revoked', userId, context });
        }
      });
      return revoked ? { ok: true } : { ok: false, code: 'SESSION_NOT_FOUND' };
    },
    updateLastSeen(token) {
      const now = dependencies.clock.now();
      dependencies.sessions.updateLastSeen(
        token,
        now.toISOString(),
        new Date(now.getTime() - LAST_SEEN_UPDATE_INTERVAL_MS).toISOString(),
      );
    },
    invalidateAllForUser(userId) {
      dependencies.sessions.deleteForUser(userId);
    },
    invalidateOtherForUser(userId, token) {
      dependencies.sessions.deleteOtherForUser(userId, token);
    },
  };
}
