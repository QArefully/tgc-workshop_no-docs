import { Type, type Static } from '@sinclair/typebox';
import { ErrorResponse, MoneyCents, PositiveIntegerString } from './common.js';
import { Product } from './products.js';

const BundleKey = Type.String({
  minLength: 1,
  maxLength: 64,
  pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
});
const BundleName = Type.String({ minLength: 1, maxLength: 160 });
const BundleDescription = Type.String({ minLength: 1, maxLength: 500 });

export const BundleVariantDetail = Type.Object(
  {
    variantId: Type.Integer({ minimum: 1 }),
    sku: Type.String({ minLength: 1, maxLength: 64 }),
    label: Type.String({ minLength: 1, maxLength: 160 }),
    weightGrams: Type.Integer({ minimum: 1 }),
    priceCents: MoneyCents,
  },
  { additionalProperties: false },
);
export type BundleVariantDetail = Static<typeof BundleVariantDetail>;

export const CuratedBundleComponent = Type.Object(
  {
    product: Product,
    variantId: Type.Optional(Type.Integer({ minimum: 1 })),
    variantDetail: Type.Optional(BundleVariantDetail),
    quantity: Type.Integer({ minimum: 1 }),
    lineTotalCents: MoneyCents,
  },
  { additionalProperties: false },
);
export type CuratedBundleComponent = Static<typeof CuratedBundleComponent>;

export const CuratedBundle = Type.Object(
  {
    id: PositiveIntegerString,
    key: BundleKey,
    name: BundleName,
    description: BundleDescription,
    components: Type.Array(CuratedBundleComponent, { minItems: 2 }),
    totalCents: MoneyCents,
    available: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type CuratedBundle = Static<typeof CuratedBundle>;

export const CuratedBundleListQuery = Type.Object(
  { productId: Type.Optional(PositiveIntegerString) },
  { additionalProperties: false },
);
export type CuratedBundleListQuery = Static<typeof CuratedBundleListQuery>;

export const CuratedBundleListResponse = Type.Array(CuratedBundle);
export type CuratedBundleListResponse = Static<typeof CuratedBundleListResponse>;

export const AddBundleToCartBody = Type.Object(
  { bundleId: PositiveIntegerString },
  { additionalProperties: false },
);
export type AddBundleToCartBody = Static<typeof AddBundleToCartBody>;

export const BundleUnavailableConflictResponse = Type.Object(
  {
    code: Type.Literal('BUNDLE_UNAVAILABLE'),
    error: Type.String({ minLength: 1, maxLength: 500 }),
    productIds: Type.Array(PositiveIntegerString, { minItems: 1, uniqueItems: true }),
  },
  { additionalProperties: false },
);
export type BundleUnavailableConflictResponse = Static<typeof BundleUnavailableConflictResponse>;

export const BundleMutationConflictResponse = Type.Union([
  BundleUnavailableConflictResponse,
  ErrorResponse,
]);
export type BundleMutationConflictResponse = Static<typeof BundleMutationConflictResponse>;
