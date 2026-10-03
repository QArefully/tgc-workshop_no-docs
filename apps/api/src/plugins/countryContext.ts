import type { FastifyInstance } from 'fastify';
import { DEFAULT_GUEST_COUNTRY, SUPPORTED_COUNTRIES, type Country } from '@shop/contracts/country';
import type { SessionService } from '../features/auth/sessionService.js';

function supportedCountry(value: unknown): Country | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return (SUPPORTED_COUNTRIES as readonly string[]).includes(normalized)
    ? (normalized as Country)
    : null;
}

/**
 * Resolves the request's browsing country after authentication. The session dependency documents
 * the required composition ordering; authentication remains the sole session lookup owner.
 */
export function countryContextPlugin(_sessions: SessionService) {
  // The session dependency is part of the composition contract; authentication owns its lookup.
  void _sessions;
  return (app: FastifyInstance, _opts: unknown, done: () => void): void => {
    app.decorateRequest('resolvedCountry', null as unknown as Country);
    // Authentication's preValidation hook is registered first by the composition root. Resolve
    // country in the same phase so schema validation and its localized errors see the final value.
    app.addHook('preValidation', (request, _reply, next) => {
      const user = request.authenticatedUser;
      const headerCountry = supportedCountry(request.headers['x-shop-country']);

      if (user?.role === 'admin' && headerCountry) {
        request.resolvedCountry = headerCountry;
      } else if (user) {
        request.resolvedCountry = supportedCountry(user.country) ?? DEFAULT_GUEST_COUNTRY;
      } else {
        request.resolvedCountry = headerCountry ?? DEFAULT_GUEST_COUNTRY;
      }
      next();
    });
    done();
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    resolvedCountry: Country;
  }
}
