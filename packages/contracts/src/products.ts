import { Type, type Static } from '@sinclair/typebox';
import { MoneyCents, PositiveIntegerString } from './common.js';
import { DeliveryClass } from './delivery.js';
import { ClearanceWindow, PriceTier } from './pricing.js';

const NormalizedCatalogKey = Type.String({
  minLength: 1,
  maxLength: 64,
  pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
});
const CatalogLabel = Type.String({ minLength: 1, maxLength: 160 });
const UtcIsoInstant = Type.String({
  minLength: 24,
  maxLength: 24,
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$',
});

/** Canonical live-bag rendering data. Omitted for non-catalog products. */
export const ProductPackaging = Type.Object(
  {
    labelColor: Type.String(),
    powderColor: Type.String(),
    mark: Type.String(),
    batchCode: Type.String(),
    quantity: Type.String(),
    consumptionLabel: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);
export type ProductPackaging = Static<typeof ProductPackaging>;

export const ProductTag = Type.Object(
  { key: NormalizedCatalogKey, label: CatalogLabel },
  { additionalProperties: false },
);
export type ProductTag = Static<typeof ProductTag>;

export const ProductSpecification = Type.Object(
  {
    key: NormalizedCatalogKey,
    label: CatalogLabel,
    valueKey: NormalizedCatalogKey,
    value: CatalogLabel,
  },
  { additionalProperties: false },
);
export type ProductSpecification = Static<typeof ProductSpecification>;

export const ProductSpecificationGroup = Type.Object(
  {
    key: NormalizedCatalogKey,
    label: CatalogLabel,
    order: Type.Integer({ minimum: 1 }),
    specifications: Type.Array(ProductSpecification, { maxItems: 8 }),
  },
  { additionalProperties: false },
);
export type ProductSpecificationGroup = Static<typeof ProductSpecificationGroup>;

export const ProductAvailability = Type.Union([
  Type.Literal('in_stock'),
  Type.Literal('backorder'),
  Type.Literal('out_of_stock'),
]);
export type ProductAvailability = Static<typeof ProductAvailability>;

export const ConsumptionClassification = Type.Union([
  Type.Literal('food'),
  Type.Literal('non-food'),
  Type.Literal('caution'),
]);
export type ConsumptionClassification = Static<typeof ConsumptionClassification>;

export const MixingGroup = Type.String({
  minLength: 1,
  maxLength: 64,
});
export type MixingGroup = Static<typeof MixingGroup>;

export const Product = Type.Object(
  {
    id: PositiveIntegerString,
    name: Type.String(),
    description: Type.String(),
    priceCents: MoneyCents,
    imageSetId: Type.String(),
    packaging: Type.Optional(ProductPackaging),
    category: Type.String(),
    stock: Type.Integer({ minimum: 0 }),
    availability: ProductAvailability,
    backorderable: Type.Boolean(),
    backorderLeadDays: Type.Union([Type.Integer({ minimum: 1, maximum: 365 }), Type.Null()]),
    slug: Type.String(),
    compareAtPriceCents: Type.Optional(MoneyCents),
    /** Catalog-list indicator resolved against the server clock. */
    hasActiveClearance: Type.Optional(Type.Boolean()),
    salesCount: Type.Integer({ minimum: 0 }),
    createdAt: UtcIsoInstant,
    available: Type.Boolean(),
    tags: Type.Array(ProductTag, { maxItems: 16 }),
    specificationGroups: Type.Array(ProductSpecificationGroup, { maxItems: 3 }),
    consumptionClassification: Type.Optional(ConsumptionClassification),
    mixingGroup: Type.Optional(Type.Union([MixingGroup, Type.Null()])),
  },
  { additionalProperties: false },
);
export type Product = Static<typeof Product>;

export const ProductSpecificationFilter = Type.Object(
  {
    key: NormalizedCatalogKey,
    label: CatalogLabel,
    values: Type.Array(ProductTag, { minItems: 1, maxItems: 64 }),
  },
  { additionalProperties: false },
);
export type ProductSpecificationFilter = Static<typeof ProductSpecificationFilter>;

export const ProductSpecificationFilterGroup = Type.Object(
  {
    key: NormalizedCatalogKey,
    label: CatalogLabel,
    order: Type.Integer({ minimum: 1 }),
    specifications: Type.Array(ProductSpecificationFilter, { minItems: 1, maxItems: 8 }),
  },
  { additionalProperties: false },
);
export type ProductSpecificationFilterGroup = Static<typeof ProductSpecificationFilterGroup>;

/** Active-catalog metadata available to catalog filter controls. */
export const ProductFilterOptionsResponse = Type.Object(
  {
    tags: Type.Array(ProductTag, { maxItems: 64 }),
    specificationGroups: Type.Array(ProductSpecificationFilterGroup, { maxItems: 3 }),
  },
  { additionalProperties: false },
);
export type ProductFilterOptionsResponse = Static<typeof ProductFilterOptionsResponse>;
export const FilterOptionsResponse = ProductFilterOptionsResponse;
export type FilterOptionsResponse = ProductFilterOptionsResponse;

export const ProductSort = Type.Union([
  Type.Literal('newest'),
  Type.Literal('oldest'),
  Type.Literal('name_asc'),
  Type.Literal('price_asc'),
  Type.Literal('price_desc'),
  Type.Literal('bestselling'),
]);
export type ProductSort = Static<typeof ProductSort>;

const CatalogDate = Type.String({
  minLength: 10,
  maxLength: 10,
  pattern: '^\\d{4}-\\d{2}-\\d{2}$',
});
const SpecificationFilterToken = Type.String({
  minLength: 3,
  maxLength: 129,
  pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$',
});

export const ProductQuery = Type.Object({
  q: Type.Optional(Type.String({ maxLength: 200 })),
  category: Type.Optional(Type.String({ maxLength: 100 })),
  onSale: Type.Optional(Type.Boolean()),
  minPriceCents: Type.Optional(Type.Integer({ minimum: 0, maximum: 1_000_000_000 })),
  maxPriceCents: Type.Optional(Type.Integer({ minimum: 0, maximum: 1_000_000_000 })),
  addedFrom: Type.Optional(CatalogDate),
  addedTo: Type.Optional(CatalogDate),
  tag: Type.Optional(Type.Array(NormalizedCatalogKey, { maxItems: 8 })),
  spec: Type.Optional(Type.Array(SpecificationFilterToken, { maxItems: 8 })),
  availability: Type.Optional(
    Type.Union([
      Type.Literal('available'),
      Type.Literal('backorder'),
      Type.Literal('out_of_stock'),
    ]),
  ),
  sort: Type.Optional(ProductSort),
  page: Type.Optional(Type.Integer({ minimum: 1, maximum: 10000 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 48 })),
});
export type ProductQuery = Static<typeof ProductQuery>;

export const ProductListPaginatedResponse = Type.Object({
  items: Type.Array(Product),
  total: Type.Integer({ minimum: 0 }),
  page: Type.Integer({ minimum: 1 }),
  pageSize: Type.Integer({ minimum: 1 }),
});
export type ProductListPaginatedResponse = Static<typeof ProductListPaginatedResponse>;

export const CategoriesResponse = Type.Array(Type.String());
export type CategoriesResponse = Static<typeof CategoriesResponse>;
export const BestsellersResponse = Type.Array(Product);
export type BestsellersResponse = Static<typeof BestsellersResponse>;
/** A bounded, comma-separated selection. Domain code additionally enforces uniqueness. */
export const ProductComparisonQuery = Type.Object(
  {
    ids: Type.String({
      minLength: 3,
      maxLength: 67,
      pattern: '^[1-9][0-9]*(?:,[1-9][0-9]*){1,3}$',
    }),
  },
  { additionalProperties: false },
);
export type ProductComparisonQuery = Static<typeof ProductComparisonQuery>;

export const ProductComparisonItem = Type.Union([
  Type.Object(
    { id: PositiveIntegerString, status: Type.Literal('available'), product: Product },
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
export type ProductComparisonItem = Static<typeof ProductComparisonItem>;

export const ProductComparisonResponse = Type.Object(
  { items: Type.Array(ProductComparisonItem, { minItems: 2, maxItems: 4 }) },
  { additionalProperties: false },
);
export type ProductComparisonResponse = Static<typeof ProductComparisonResponse>;

export const SimilarProductsResponse = Type.Array(Product, { maxItems: 5 });
export type SimilarProductsResponse = Static<typeof SimilarProductsResponse>;
/** Compatibility name retained while clients transition to /similar. */
export const RelatedResponse = SimilarProductsResponse;
export type RelatedResponse = SimilarProductsResponse;
export const ProductListResponse = Type.Array(Product);
export type ProductListResponse = Static<typeof ProductListResponse>;
export const ProductDetailResponse = Product;
export type ProductDetailResponse = Static<typeof ProductDetailResponse>;

export const ProductIdParam = Type.Object({ id: PositiveIntegerString });

export const BaseProductFacts = Type.Object(
  {
    texture: Type.String({ minLength: 1, maxLength: 200 }),
    colour: Type.String({ minLength: 1, maxLength: 200 }),
    source: Type.String({ minLength: 1, maxLength: 500 }),
    intendedUse: Type.String({ minLength: 1, maxLength: 500 }),
    storage: Type.String({ minLength: 1, maxLength: 500 }),
    consumptionClassification: ConsumptionClassification,
  },
  { additionalProperties: false },
);
export type BaseProductFacts = Static<typeof BaseProductFacts>;

export const EdibleFacts = Type.Object(
  {
    ...BaseProductFacts.properties,
    ingredients: Type.Array(Type.String({ minLength: 1, maxLength: 200 }), {
      minItems: 1,
      maxItems: 50,
    }),
    allergens: Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: 20 }),
    nutrition: Type.Record(Type.String(), Type.String()),
    servingSize: Type.String({ minLength: 1, maxLength: 100 }),
    dietaryAttributes: Type.Array(Type.String({ minLength: 1, maxLength: 100 }), { maxItems: 20 }),
  },
  { additionalProperties: false },
);
export type EdibleFacts = Static<typeof EdibleFacts>;

export const SportsFacts = Type.Object(
  {
    ...EdibleFacts.properties,
    flavour: Type.String({ minLength: 1, maxLength: 200 }),
    servings: Type.Integer({ minimum: 1 }),
    proteinPerServing: Type.Number({ minimum: 0 }),
    carbsPerServing: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type SportsFacts = Static<typeof SportsFacts>;

export const GardenFacts = Type.Object(
  {
    ...BaseProductFacts.properties,
    npk: Type.String({ minLength: 1, maxLength: 50 }),
    coverage: Type.String({ minLength: 1, maxLength: 200 }),
    application: Type.String({ minLength: 1, maxLength: 500 }),
    handling: Type.String({ minLength: 1, maxLength: 500 }),
  },
  { additionalProperties: false },
);
export type GardenFacts = Static<typeof GardenFacts>;

export const CleaningFacts = Type.Object(
  {
    ...BaseProductFacts.properties,
    surfaces: Type.Array(Type.String({ minLength: 1, maxLength: 200 }), {
      minItems: 1,
      maxItems: 20,
    }),
    dosage: Type.String({ minLength: 1, maxLength: 200 }),
    hazardStatement: Type.String({ minLength: 1, maxLength: 500 }),
    handling: Type.String({ minLength: 1, maxLength: 500 }),
  },
  { additionalProperties: false },
);
export type CleaningFacts = Static<typeof CleaningFacts>;

export const TradeFacts = Type.Object(
  {
    ...BaseProductFacts.properties,
    composition: Type.String({ minLength: 1, maxLength: 500 }),
    waterRatio: Type.String({ minLength: 1, maxLength: 100 }),
    coverage: Type.String({ minLength: 1, maxLength: 200 }),
    settingTime: Type.String({ minLength: 1, maxLength: 100 }),
    ppe: Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: 10 }),
  },
  { additionalProperties: false },
);
export type TradeFacts = Static<typeof TradeFacts>;

export const TheatricalFacts = Type.Object(
  {
    ...BaseProductFacts.properties,
    approvedApplication: Type.String({ minLength: 1, maxLength: 500 }),
    cleanup: Type.String({ minLength: 1, maxLength: 500 }),
    colourProfile: Type.String({ minLength: 1, maxLength: 200 }),
    particleAppearance: Type.String({ minLength: 1, maxLength: 500 }),
    ppe: Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: 10 }),
  },
  { additionalProperties: false },
);
export type TheatricalFacts = Static<typeof TheatricalFacts>;

export const CategoryFacts = Type.Union([
  SportsFacts,
  GardenFacts,
  CleaningFacts,
  TradeFacts,
  TheatricalFacts,
  EdibleFacts,
  BaseProductFacts,
]);
export type CategoryFacts = Static<typeof CategoryFacts>;

export const CatalogVariant = Type.Object(
  {
    variantId: Type.Integer({ minimum: 1 }),
    productId: Type.Integer({ minimum: 1 }),
    sku: Type.String({ minLength: 1, maxLength: 64 }),
    label: Type.String({ minLength: 1, maxLength: 160 }),
    weightGrams: Type.Integer({ minimum: 1 }),
    priceCents: MoneyCents,
    moqSacks: Type.Integer({ minimum: 1 }),
    perTonneCents: MoneyCents,
    priceTiers: Type.Array(PriceTier, { minItems: 1 }),
    compareAtPriceCents: Type.Optional(MoneyCents),
    clearance: Type.Optional(ClearanceWindow),
    stockCount: Type.Integer({ minimum: 0 }),
    backorderable: Type.Boolean(),
    backorderLeadDays: Type.Union([Type.Integer({ minimum: 1, maximum: 365 }), Type.Null()]),
    deliveryClass: DeliveryClass,
    active: Type.Boolean(),
    sortOrder: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);
export type CatalogVariant = Static<typeof CatalogVariant>;

export const PriceRange = Type.Object(
  {
    min: MoneyCents,
    max: MoneyCents,
  },
  { additionalProperties: false },
);
export type PriceRange = Static<typeof PriceRange>;

export const BaseAvailability = Type.Union([
  Type.Literal('in_stock'),
  Type.Literal('low_stock'),
  Type.Literal('out_of_stock'),
  Type.Literal('backorder'),
]);
export type BaseAvailability = Static<typeof BaseAvailability>;

export const ProductWithVariants = Type.Object(
  {
    ...Product.properties,
    variants: Type.Array(CatalogVariant, { minItems: 1 }),
    defaultVariantId: Type.Integer({ minimum: 1 }),
    categoryFacts: CategoryFacts,
    consumptionClassification: ConsumptionClassification,
    mixingGroup: Type.Union([MixingGroup, Type.Null()]),
    priceRange: PriceRange,
    baseAvailability: BaseAvailability,
  },
  { additionalProperties: false },
);
export type ProductWithVariants = Static<typeof ProductWithVariants>;
