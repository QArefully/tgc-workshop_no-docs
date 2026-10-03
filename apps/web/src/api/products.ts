import { Type, type Static } from '@sinclair/typebox';
import { apiFetch } from './client';
import {
  CategoriesResponse,
  ProductFilterOptionsResponse,
  ProductWithVariants,
  CatalogVariant,
  PriceRange,
  CategoryFacts,
  ConsumptionClassification,
  BaseAvailability,
  MixingGroup,
  Product,
} from '@shop/contracts/products';
import { PositiveIntegerString } from '@shop/contracts/common';
import type { ProductQuery } from '@shop/contracts/products';
import { serializeCatalogQuery } from '@/catalogQuery';

const RelaxedProduct = Type.Object(
  {
    ...Product.properties,
    variants: Type.Optional(Type.Array(CatalogVariant, { minItems: 1 })),
    defaultVariantId: Type.Optional(Type.Integer({ minimum: 1 })),
    categoryFacts: Type.Optional(CategoryFacts),
    consumptionClassification: Type.Optional(ConsumptionClassification),
    mixingGroup: Type.Optional(Type.Union([MixingGroup, Type.Null()])),
    priceRange: Type.Optional(PriceRange),
    baseAvailability: Type.Optional(BaseAvailability),
  },
  { additionalProperties: false },
);

const VariantProductList = Type.Object({
  items: Type.Array(RelaxedProduct),
  total: Type.Integer({ minimum: 0 }),
  page: Type.Integer({ minimum: 1 }),
  pageSize: Type.Integer({ minimum: 1 }),
});
export type VariantProductList = Static<typeof VariantProductList>;

const VariantBestsellers = Type.Array(RelaxedProduct);
const VariantSimilar = Type.Array(RelaxedProduct);

const ComparisonItem = Type.Union([
  Type.Object(
    {
      id: PositiveIntegerString,
      status: Type.Literal('available'),
      product: RelaxedProduct,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { id: PositiveIntegerString, status: Type.Literal('inactive') },
    { additionalProperties: false },
  ),
  Type.Object(
    { id: PositiveIntegerString, status: Type.Literal('missing') },
    { additionalProperties: false },
  ),
]);

const VariantComparisonResponse = Type.Object(
  { items: Type.Array(ComparisonItem, { minItems: 2, maxItems: 4 }) },
  { additionalProperties: false },
);

export type GetProductsParams = ProductQuery;

export function getProducts(
  params?: GetProductsParams,
  signal?: AbortSignal,
): Promise<VariantProductList> {
  const qs = serializeCatalogQuery(params).toString();
  return apiFetch(VariantProductList, `/api/products${qs ? `?${qs}` : ''}`, { signal });
}

export function getProduct(id: string, signal?: AbortSignal): Promise<ProductWithVariants> {
  return apiFetch(ProductWithVariants, `/api/products/${id}`, { signal });
}

export function getCategories(): Promise<CategoriesResponse> {
  return apiFetch(CategoriesResponse, '/api/products/categories');
}

export function getBestsellers(): Promise<Static<typeof VariantBestsellers>> {
  return apiFetch(VariantBestsellers, '/api/products/bestsellers');
}

export function getRelatedProducts(id: string): Promise<Static<typeof VariantSimilar>> {
  return apiFetch(VariantSimilar, `/api/products/${id}/related`);
}

export function getSimilarProducts(
  id: string,
  signal?: AbortSignal,
): Promise<Static<typeof VariantSimilar>> {
  return apiFetch(VariantSimilar, `/api/products/${id}/similar`, { signal });
}

export function getProductComparison(
  ids: readonly string[],
  signal?: AbortSignal,
): Promise<Static<typeof VariantComparisonResponse>> {
  const params = new URLSearchParams({ ids: ids.join(',') });
  return apiFetch(VariantComparisonResponse, `/api/products/compare?${params.toString()}`, {
    signal,
  });
}

export function getProductFilterOptions(
  signal?: AbortSignal,
): Promise<ProductFilterOptionsResponse> {
  return apiFetch(ProductFilterOptionsResponse, '/api/products/filter-options', { signal });
}
