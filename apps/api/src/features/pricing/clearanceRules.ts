import type { ClearanceWindow } from '@shop/contracts/pricing';
import { perTonneCents } from './pricingRules.js';

export interface ResolveClearanceParams {
  priceCents: number;
  clearancePriceCents: number | null;
  clearanceStartsAt: string | null;
  clearanceEndsAt: string | null;
  weightGrams: number;
  now: Date;
}

export interface ClearanceResolution {
  basePriceCents: number;
  clearance: ClearanceWindow | null;
}

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function timestamp(value: string | null): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Resolves a valid, active clearance window. An incomplete, malformed, expired, or future
 * clearance safely falls back to the list price; time is always supplied by the caller's clock.
 */
export function resolveClearance({
  priceCents,
  clearancePriceCents,
  clearanceStartsAt,
  clearanceEndsAt,
  weightGrams,
  now,
}: ResolveClearanceParams): ClearanceResolution {
  const fallback = { basePriceCents: priceCents, clearance: null };
  if (!isNonNegativeSafeInteger(priceCents)) return fallback;
  if (
    clearancePriceCents === null ||
    !Number.isSafeInteger(clearancePriceCents) ||
    clearancePriceCents <= 0 ||
    clearancePriceCents >= priceCents
  ) {
    return fallback;
  }

  if (typeof clearanceStartsAt !== 'string' || typeof clearanceEndsAt !== 'string') return fallback;
  const startsAt = timestamp(clearanceStartsAt);
  const endsAt = timestamp(clearanceEndsAt);
  const nowAt = now instanceof Date ? now.getTime() : Number.NaN;
  if (
    startsAt === null ||
    endsAt === null ||
    !Number.isFinite(nowAt) ||
    startsAt >= endsAt ||
    nowAt < startsAt ||
    nowAt >= endsAt
  ) {
    return fallback;
  }

  return {
    basePriceCents: priceCents,
    clearance: {
      priceCents: clearancePriceCents,
      perTonneCents: perTonneCents(clearancePriceCents, weightGrams),
      startsAt: clearanceStartsAt,
      endsAt: clearanceEndsAt,
    },
  };
}
