import { Type, type Static } from '@sinclair/typebox';
import { MoneyCents, PromoCodeValue, Uuid } from './common.js';

export const PromoCodeKind = Type.Union([Type.Literal('percent'), Type.Literal('fixed')]);
export const PromoCode = Type.Object({
  code: PromoCodeValue,
  discountPercent: Type.Number({ minimum: 0, maximum: 100 }),
  minItemCount: Type.Integer({ minimum: 0 }),
  kind: PromoCodeKind,
  amountCents: Type.Optional(MoneyCents),
  minSubtotalCents: Type.Optional(MoneyCents),
  categoryScope: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
});
export type PromoCode = Static<typeof PromoCode>;

export const PromoValidationErrorCode = Type.Union([
  Type.Literal('EXPIRED'),
  Type.Literal('NOT_STARTED'),
  Type.Literal('MIN_ITEMS'),
  Type.Literal('MIN_SUBTOTAL'),
  Type.Literal('USAGE_LIMIT'),
  Type.Literal('AUTH_REQUIRED'),
  Type.Literal('CATEGORY_MISMATCH'),
  Type.Literal('INVALID'),
]);
export type PromoValidationErrorCode = Static<typeof PromoValidationErrorCode>;

export const ValidatePromoBody = Type.Object({ promoCode: PromoCodeValue, cartId: Uuid });
export type ValidatePromoBody = Static<typeof ValidatePromoBody>;
export const ValidatePromoResponse = Type.Object({
  valid: Type.Boolean(),
  promoCode: Type.Optional(PromoCode),
  error: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  errorCode: Type.Optional(PromoValidationErrorCode),
  /** Canonical GBP pence threshold returned for a failed minimum-subtotal gate. */
  minSubtotalCents: Type.Optional(MoneyCents),
  discountBaseCents: Type.Optional(MoneyCents),
  discountCents: Type.Optional(MoneyCents),
  totalCents: Type.Optional(MoneyCents),
});
export type ValidatePromoResponse = Static<typeof ValidatePromoResponse>;
