import type { FastifyReply, FastifyRequest } from 'fastify';
import { Value } from '@sinclair/typebox/value';
import { DEFAULT_GUEST_COUNTRY, SUPPORTED_COUNTRIES, type Country } from '@shop/contracts/country';
import {
  PublicErrorMetaByCodeSchema,
  type PublicErrorArgs,
  type PublicErrorCode,
  type PublicErrorResponse,
} from '@shop/contracts/public-errors';
import { translate } from '@shop/localisation';
import { apiErrors } from '@shop/localisation/messages/apiErrors';

function requestCountry(request: FastifyRequest): Country {
  const value = request.resolvedCountry;
  if ((SUPPORTED_COUNTRIES as readonly string[]).includes(value)) return value;

  // Body parsing errors run before preValidation resolves account country. Use only the strict
  // request header at that point; invalid or repeated values fall back to guest country.
  const header = request.headers['x-shop-country'];
  if (typeof header === 'string') {
    const normalized = header.trim().toUpperCase();
    if ((SUPPORTED_COUNTRIES as readonly string[]).includes(normalized)) {
      return normalized as Country;
    }
  }
  return DEFAULT_GUEST_COUNTRY;
}

function localisedErrorMessage(country: Country, code: PublicErrorCode, meta: unknown): string {
  // Metadata is transport input, so only primitive values are interpolation parameters. Array
  // metadata is intentionally retained in the response but never interpolated into copy.
  const params: Record<string, string | number | bigint> = {};
  if (meta !== undefined && typeof meta === 'object' && meta !== null) {
    for (const [key, value] of Object.entries(meta)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
        params[key] = value;
      }
    }
  }

  return translate(apiErrors, country, code, params);
}

/**
 * Emit a typed public error at an HTTP boundary. Metadata is checked against the code-specific
 * schema before it crosses the wire; malformed metadata is omitted rather than reflected.
 */
export function sendPublicError<Code extends PublicErrorCode>(
  request: FastifyRequest,
  reply: FastifyReply,
  statusCode: number,
  ...args: PublicErrorArgs<Code>
): void {
  const [code, meta] = args;
  const schema = PublicErrorMetaByCodeSchema[code];
  const validMeta = meta !== undefined && Value.Check(schema, meta);
  const safeMeta = validMeta ? meta : undefined;
  const country = requestCountry(request);
  let error: string;
  try {
    error = localisedErrorMessage(country, code, safeMeta);
  } catch {
    // A missing/invalid interpolation must not pair an application code with INTERNAL_ERROR copy.
    // Collapse the whole response to the generic public identity instead.
    let fallback = 'Something went wrong. Please try again.';
    try {
      fallback = translate(apiErrors, country, 'INTERNAL_ERROR');
    } catch {
      // The checked-in catalog is exhaustive; keep a non-sensitive final guard for malformed
      // runtime catalogs rather than reflecting the translation exception.
    }
    const fallbackBody: PublicErrorResponse = { error: fallback, code: 'INTERNAL_ERROR' };
    reply.code(statusCode).send(fallbackBody);
    return;
  }

  const body = {
    error,
    code,
    ...(safeMeta === undefined ? {} : { meta: safeMeta }),
  };
  reply.code(statusCode).send(body);
}
