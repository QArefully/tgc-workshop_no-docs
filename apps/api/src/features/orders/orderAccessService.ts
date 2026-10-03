import { createHash, randomBytes } from 'node:crypto';
import type { Clock } from '../auth/authService.js';
import type { OrderAccessRepository } from './orderRepository.js';

const ACCESS_DURATION_MS = 24 * 60 * 60 * 1000;
export type OrderAccessTokenSource = () => string;

export interface OrderAccessService {
  issue(orderId: number): { token: string; expiresAt: string };
  validate(orderId: number, token: string | undefined): boolean;
}

export function digestOrderAccessToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createOrderAccessService(dependencies: {
  repository: OrderAccessRepository;
  clock: Clock;
  tokenSource?: OrderAccessTokenSource;
}): OrderAccessService {
  const tokenSource = dependencies.tokenSource ?? (() => randomBytes(32).toString('hex'));
  return {
    issue(orderId) {
      const now = dependencies.clock.now();
      const token = tokenSource();
      const expiresAt = new Date(now.getTime() + ACCESS_DURATION_MS).toISOString();
      dependencies.repository.replaceAccessGrant({
        orderId,
        tokenDigest: digestOrderAccessToken(token),
        expiresAt,
        createdAt: now.toISOString(),
      });
      return { token, expiresAt };
    },
    validate(orderId, token) {
      if (!token) return false;
      return dependencies.repository.hasValidAccessGrant(
        orderId,
        digestOrderAccessToken(token),
        dependencies.clock.now().toISOString(),
      );
    },
  };
}
