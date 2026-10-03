export const CATALOG_CATEGORIES = [
  'Sports Nutrition',
  'Baking & Pantry',
  'Drinks',
  'Household & Cleaning',
  'Garden & Outdoors',
  'Trade & Creative Materials',
] as const;
export type CatalogCategory = (typeof CATALOG_CATEGORIES)[number];

export const MIXING_GROUPS = [
  'food-grade',
  'cleaning',
  'garden-treatment',
  'cementitious-materials',
  'casting-materials',
  'pigments',
  'theatrical-effects',
  'absorbents',
] as const;
export type MixingGroup = (typeof MIXING_GROUPS)[number];

export type ConsumptionClassification = 'food' | 'non-food' | 'caution';

export type DeliveryClass = 'parcel' | 'freight';

export type BaseProductFacts = {
  texture: string;
  colour: string;
  source: string;
  intendedUse: string;
  storage: string;
  consumptionClassification: ConsumptionClassification;
};

export type EdibleFacts = BaseProductFacts & {
  ingredients: string[];
  allergens: string[];
  nutrition: Record<string, string>;
  servingSize: string;
  dietaryAttributes: string[];
};

export type SportsFacts = EdibleFacts & {
  flavour: string;
  servings: number;
  proteinPerServing: number;
  carbsPerServing: number;
};

export type GardenFacts = BaseProductFacts & {
  npk: string;
  coverage: string;
  application: string;
  handling: string;
};

export type CleaningFacts = BaseProductFacts & {
  surfaces: string[];
  dosage: string;
  hazardStatement: string;
  handling: string;
};

export type TradeFacts = BaseProductFacts & {
  composition: string;
  waterRatio: string;
  coverage: string;
  settingTime: string;
  ppe: string[];
};

export type TheatricalFacts = BaseProductFacts & {
  approvedApplication: string;
  cleanup: string;
  colourProfile: string;
  particleAppearance: string;
  ppe: string[];
};

export type CategoryFacts =
  | SportsFacts
  | EdibleFacts
  | GardenFacts
  | CleaningFacts
  | TradeFacts
  | TheatricalFacts
  | BaseProductFacts;

export type CatalogVariant = {
  sku: string;
  label: string;
  weightGrams: number;
  priceCents: number;
  compareAtPriceCents?: number;
  clearancePriceCents?: number;
  clearanceStartsAt?: string;
  clearanceEndsAt?: string;
  stockCount: number;
  backorderable: boolean;
  backorderLeadDays?: number;
  deliveryClass: DeliveryClass;
  active: boolean;
  sortOrder: number;
  moqSacks: number;
};

export type CatalogProduct = {
  id: number;
  slug: string;
  name: string;
  description: string;
  category: CatalogCategory;
  mixingGroup: string | null;
  consumptionClassification: ConsumptionClassification;
  imageSetId: string;
  baseFacts: BaseProductFacts;
  categoryFacts: CategoryFacts;
  tags: string[];
  createdAt: string;
  visibility: 'public' | 'hidden';
  onSale: boolean;
  variants: CatalogVariant[];
};

export const FREIGHT_WEIGHT_THRESHOLD_GRAMS = 100_000;
export const FREIGHT_CHARGE_CENTS = 999;
export const PARCEL_CHARGE_CENTS = 0;

export const NORMALIZED_CATALOG_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const isNormalizedCatalogKey = (value: string): boolean =>
  value.length <= 64 && NORMALIZED_CATALOG_KEY.test(value);

export const isUtcIsoInstant = (value: string): boolean => {
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
};

export const CATALOG_CREATED_AT_BY_ID: Readonly<Record<number, string>> = {
  1: '2025-01-01T00:00:00.000Z',
  2: '2025-01-02T00:00:00.000Z',
  3: '2025-01-03T00:00:00.000Z',
  4: '2025-01-04T00:00:00.000Z',
  5: '2025-01-05T00:00:00.000Z',
  6: '2025-01-06T00:00:00.000Z',
  7: '2025-01-07T00:00:00.000Z',
  8: '2025-01-08T00:00:00.000Z',
  9: '2025-01-09T00:00:00.000Z',
  10: '2025-01-10T00:00:00.000Z',
  11: '2025-01-11T00:00:00.000Z',
  12: '2025-01-12T00:00:00.000Z',
  13: '2025-01-13T00:00:00.000Z',
  14: '2025-01-14T00:00:00.000Z',
  15: '2025-01-15T00:00:00.000Z',
  16: '2025-01-16T00:00:00.000Z',
  17: '2025-01-17T00:00:00.000Z',
  18: '2025-01-18T00:00:00.000Z',
  19: '2025-01-19T00:00:00.000Z',
  20: '2025-01-20T00:00:00.000Z',
  21: '2025-01-21T00:00:00.000Z',
  22: '2025-01-22T00:00:00.000Z',
  23: '2025-01-23T00:00:00.000Z',
  24: '2025-01-24T00:00:00.000Z',
  25: '2025-01-25T00:00:00.000Z',
  26: '2025-01-26T00:00:00.000Z',
  27: '2025-01-27T00:00:00.000Z',
  28: '2025-01-28T00:00:00.000Z',
  29: '2025-01-29T00:00:00.000Z',
  30: '2025-01-30T00:00:00.000Z',
  31: '2025-01-31T00:00:00.000Z',
  32: '2025-02-01T00:00:00.000Z',
  33: '2025-02-02T00:00:00.000Z',
  34: '2025-02-03T00:00:00.000Z',
  35: '2025-02-04T00:00:00.000Z',
  36: '2025-02-05T00:00:00.000Z',
  37: '2025-02-06T00:00:00.000Z',
  38: '2025-02-07T00:00:00.000Z',
  39: '2025-02-08T00:00:00.000Z',
  40: '2025-02-09T00:00:00.000Z',
  41: '2025-02-10T00:00:00.000Z',
  42: '2025-02-11T00:00:00.000Z',
  43: '2025-02-12T00:00:00.000Z',
  44: '2025-02-13T00:00:00.000Z',
  45: '2025-02-14T00:00:00.000Z',
  46: '2025-02-15T00:00:00.000Z',
  47: '2025-02-16T00:00:00.000Z',
  48: '2025-02-17T00:00:00.000Z',
  49: '2025-02-18T00:00:00.000Z',
  50: '2025-02-19T00:00:00.000Z',
  1001: '2025-02-20T00:00:00.000Z',
  1002: '2025-02-21T00:00:00.000Z',
  1003: '2025-02-22T00:00:00.000Z',
  1004: '2025-02-23T00:00:00.000Z',
  1005: '2025-02-24T00:00:00.000Z',
  1006: '2025-02-25T00:00:00.000Z',
  1007: '2025-02-26T00:00:00.000Z',
  1008: '2025-02-27T00:00:00.000Z',
  1009: '2025-02-28T00:00:00.000Z',
  1010: '2025-03-01T00:00:00.000Z',
  1011: '2025-03-02T00:00:00.000Z',
  1012: '2025-03-03T00:00:00.000Z',
  1013: '2025-03-04T00:00:00.000Z',
  1014: '2025-03-05T00:00:00.000Z',
  1015: '2025-03-06T00:00:00.000Z',
  1016: '2025-03-07T00:00:00.000Z',
  1017: '2025-03-08T00:00:00.000Z',
  1018: '2025-03-09T00:00:00.000Z',
  1019: '2025-03-10T00:00:00.000Z',
  1020: '2025-03-11T00:00:00.000Z',
  1021: '2025-03-12T00:00:00.000Z',
  1022: '2025-03-13T00:00:00.000Z',
  1023: '2025-03-14T00:00:00.000Z',
  1024: '2025-03-15T00:00:00.000Z',
  1025: '2025-03-16T00:00:00.000Z',
  1026: '2025-03-17T00:00:00.000Z',
  1027: '2025-03-18T00:00:00.000Z',
  1028: '2025-03-19T00:00:00.000Z',
  1029: '2025-03-20T00:00:00.000Z',
  1030: '2025-03-21T00:00:00.000Z',
  1031: '2025-03-22T00:00:00.000Z',
  1032: '2025-03-23T00:00:00.000Z',
  1033: '2025-03-24T00:00:00.000Z',
  1034: '2025-03-25T00:00:00.000Z',
  1035: '2025-03-26T00:00:00.000Z',
  1036: '2025-03-27T00:00:00.000Z',
  1037: '2025-03-28T00:00:00.000Z',
  1038: '2025-03-29T00:00:00.000Z',
  1039: '2025-03-30T00:00:00.000Z',
  1040: '2025-03-31T00:00:00.000Z',
  1041: '2025-04-01T00:00:00.000Z',
  1042: '2025-04-02T00:00:00.000Z',
  1043: '2025-04-03T00:00:00.000Z',
  1044: '2025-04-04T00:00:00.000Z',
  1045: '2025-04-05T00:00:00.000Z',
  1046: '2025-04-06T00:00:00.000Z',
  1047: '2025-04-07T00:00:00.000Z',
  1048: '2025-04-08T00:00:00.000Z',
  1049: '2025-04-09T00:00:00.000Z',
  1050: '2025-04-10T00:00:00.000Z',
};

export const makeVariant = (
  sku: string,
  _label: string,
  _weightGrams: number,
  priceCents: number,
  stockCount: number,
  sortOrder: number,
  opts?: {
    compareAtPriceCents?: number;
    clearancePriceCents?: number;
    clearanceStartsAt?: string;
    clearanceEndsAt?: string;
    backorderable?: boolean;
    backorderLeadDays?: number;
    active?: boolean;
  },
): CatalogVariant => {
  const sackPriceCents = Math.max(priceCents * 12, 2_500);
  return {
    sku,
    label: sortOrder === 1 ? '25 kg Sack' : '1,000 kg Pallet',
    weightGrams: sortOrder === 1 ? 25_000 : 1_000_000,
    priceCents: sortOrder === 1 ? sackPriceCents : sackPriceCents * 32,
    compareAtPriceCents: opts?.compareAtPriceCents,
    clearancePriceCents: opts?.clearancePriceCents,
    clearanceStartsAt: opts?.clearanceStartsAt,
    clearanceEndsAt: opts?.clearanceEndsAt,
    stockCount,
    backorderable: opts?.backorderable ?? false,
    backorderLeadDays: opts?.backorderable ? (opts?.backorderLeadDays ?? undefined) : undefined,
    deliveryClass: 'freight',
    active: opts?.active ?? true,
    sortOrder,
    moqSacks: 4,
  };
};

const withoutPowder = (value: string): string =>
  value
    .replace(/\bpowdered\b/gi, 'dry')
    .replace(/\bpowder\b/gi, 'material')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();

/** Converts retail-pack facts into consistent industrial sack and pallet catalog facts. */
export const industrializeProducts = (
  products: readonly CatalogProduct[],
): readonly CatalogProduct[] =>
  products.map((product) => ({
    ...product,
    name: withoutPowder(product.name),
    description: withoutPowder(product.description),
    variants: product.variants.slice(0, 2).map((variant, index) => {
      const priceCents =
        index === 0
          ? variant.priceCents
          : Math.max(variant.priceCents, product.variants[0]!.priceCents * 32, 10_000);
      return {
        ...variant,
        label: index === 0 ? '25 kg Sack' : '1,000 kg Pallet',
        weightGrams: index === 0 ? 25_000 : 1_000_000,
        priceCents,
        compareAtPriceCents:
          variant.compareAtPriceCents === undefined
            ? undefined
            : Math.max(variant.compareAtPriceCents, priceCents + Math.ceil(priceCents / 10)),
        deliveryClass: 'freight' as const,
        sortOrder: index + 1,
        moqSacks: 4,
      };
    }),
  }));
