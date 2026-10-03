import { Type, type Static } from '@sinclair/typebox';
import { MoneyCents } from './common.js';

export const SACK_WEIGHT_GRAMS = 25_000;
export const PALLET_WEIGHT_GRAMS = 1_000_000;
export const SACKS_PER_PALLET = 40;
export const MOQ_DEFAULT_SACKS = 4;
export const CUSTOM_BLEND_FEE_CENTS = 2_500;

/** A currently active clearance price and its effective UTC window. */
export const ClearanceWindow = Type.Object(
  {
    priceCents: MoneyCents,
    perTonneCents: MoneyCents,
    startsAt: Type.String(),
    endsAt: Type.String(),
  },
  { additionalProperties: false },
);
export type ClearanceWindow = Static<typeof ClearanceWindow>;

export const PriceTier = Type.Object(
  {
    minTonnes: Type.Integer({ minimum: 1 }),
    discountPct: Type.Integer({ minimum: 0, maximum: 100 }),
  },
  { additionalProperties: false },
);
export type PriceTier = Static<typeof PriceTier>;

/** Server-resolved progress from a cart line to its next unqualified tier. */
export const NextTierProgress = Type.Object(
  {
    minTonnes: Type.Integer({ minimum: 1 }),
    discountPct: Type.Integer({ minimum: 0, maximum: 100 }),
    sacksToNextTier: Type.Integer({ minimum: 1 }),
    weightToNextTierGrams: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);
export type NextTierProgress = Static<typeof NextTierProgress>;

export const TierLadder = Type.Array(PriceTier, { minItems: 1 });
export type TierLadder = Static<typeof TierLadder>;

export const TIER_LADDER = [
  { minTonnes: 1, discountPct: 0 },
  { minTonnes: 5, discountPct: 5 },
  { minTonnes: 10, discountPct: 10 },
] as const satisfies TierLadder;
