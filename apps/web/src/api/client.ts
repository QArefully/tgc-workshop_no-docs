import { type Static, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { ErrorResponse as ErrorResponseSchema, type ErrorResponse } from '@shop/contracts/common';
import { DEFAULT_GUEST_COUNTRY, SUPPORTED_COUNTRIES, type Country } from '@shop/contracts/country';
import {
  PublicErrorCode as PublicErrorCodeSchema,
  PublicErrorMetaByCodeSchema,
  type PublicErrorCode,
} from '@shop/contracts/public-errors';

/**
 * Core fetch wrapper for the Shop Qarefully API.
 * Includes credentials (cookies) on every request.
 * All feature modules should use this as their base.
 */

let activeCountry: Country | null = null;

function isCountry(value: unknown): value is Country {
  return typeof value === 'string' && (SUPPORTED_COUNTRIES as readonly string[]).includes(value);
}

function resolveRequestCountry(value: unknown): Country {
  return isCountry(value) ? value : DEFAULT_GUEST_COUNTRY;
}

/** Keeps the request country aligned with the mounted country provider. */
export function setActiveApiCountry(country: Country | null): void {
  activeCountry = country;
}

function isErrorResponse(value: unknown): value is ErrorResponse {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  if (typeof value.error !== 'string') return false;
  // Coded responses are validated strictly so an unknown code or unsafe metadata cannot become a
  // typed descriptor. Legacy route envelopes may carry feature-specific fields (for example a
  // payment failure reason) until their packets migrate to the public-error contract.
  return 'code' in value || 'meta' in value ? Value.Check(ErrorResponseSchema, value) : true;
}

/** Runtime-safe metadata shape exposed to web error presenters. */
export type ApiErrorMeta = Readonly<Record<string, unknown>>;

function isApiErrorMeta(value: unknown): value is ApiErrorMeta {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Stable client-side error descriptor carried by every ApiError instance. */
export interface ApiErrorDescriptor {
  readonly code: PublicErrorCode | null;
  readonly meta: ApiErrorMeta | null;
  readonly requestCountry: Country;
  readonly country: Country;
}

export class ApiError extends Error implements ApiErrorDescriptor {
  readonly status: number | null;
  readonly response: ErrorResponse | null;
  /** Stable machine-readable identity; null is retained for legacy/network failures. */
  readonly code: PublicErrorCode | null;
  /** Code-specific safe metadata, when supplied by a coded response. */
  readonly meta: ApiErrorMeta | null;
  /** Country captured when this request was issued, not when its promise settled. */
  readonly requestCountry: Country;
  /** Short compatibility alias for consumers that call the descriptor's country `country`. */
  readonly country: Country;

  constructor(
    message: string,
    status: number | null,
    response: ErrorResponse | null = null,
    requestCountry: Country | null = resolveRequestCountry(activeCountry),
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.response = response;
    const candidate = response && 'code' in response ? response.code : null;
    this.code =
      typeof candidate === 'string' && Value.Check(PublicErrorCodeSchema, candidate)
        ? candidate
        : null;
    const responseMeta =
      this.code !== null && response && 'meta' in response ? response.meta : null;
    this.meta =
      this.code !== null &&
      responseMeta !== null &&
      responseMeta !== undefined &&
      isApiErrorMeta(responseMeta) &&
      Value.Check(PublicErrorMetaByCodeSchema[this.code], responseMeta)
        ? responseMeta
        : null;
    this.requestCountry = resolveRequestCountry(requestCountry);
    this.country = this.requestCountry;
  }

  get isNetworkError(): boolean {
    return this.status === null;
  }
}

export class ApiContractError extends Error {
  readonly path: string;
  readonly validationSummary: string;

  constructor(path: string, validationSummary: string) {
    super(`Response contract violation for ${path}: ${validationSummary}`);
    this.name = 'ApiContractError';
    this.path = path;
    this.validationSummary = validationSummary;
  }
}

export function isMissingCartError(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    error.status === 404 &&
    (error.code === 'CART_NOT_FOUND' || error.message === 'Cart not found')
  );
}

/**
 * Core fetch function. Sends credentials with every request.
 * All feature API modules delegate to this.
 */
async function fetchWithResponseSchema<T extends TSchema>(
  schema: T,
  path: string,
  options?: RequestInit,
): Promise<Static<T>> {
  // Snapshot the country before awaiting fetch: the provider may switch countries while this
  // request is in flight, but its error descriptor must describe the request that was sent.
  const requestCountry = resolveRequestCountry(activeCountry);
  const mergedHeaders = new Headers(options?.headers);
  if (isCountry(activeCountry)) {
    mergedHeaders.set('x-shop-country', activeCountry);
  }
  if (options?.body && typeof options.body === 'string') {
    mergedHeaders.set('Content-Type', 'application/json');
  }
  let res: Response;
  try {
    res = await fetch(path, {
      ...options,
      headers: mergedHeaders,
      credentials: 'include',
    });
  } catch (error) {
    throw new ApiError(
      error instanceof Error ? error.message : 'Unable to reach the server',
      null,
      null,
      requestCountry,
    );
  }
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const errorResponse = isErrorResponse(body) ? body : null;
    throw new ApiError(
      errorResponse?.error ?? `Request failed: ${res.status}`,
      res.status,
      errorResponse,
      requestCountry,
    );
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiContractError(path, 'successful response did not contain valid JSON');
  }
  if (!Value.Check(schema, body)) {
    const error = [...Value.Errors(schema, body)][0];
    const summary = error ? `${error.path || '/'}: ${error.message}` : 'schema validation failed';
    throw new ApiContractError(path, summary);
  }
  return body;
}

export { fetchWithResponseSchema as apiFetch };
