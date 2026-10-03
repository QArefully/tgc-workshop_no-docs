import {
  CATALOG_ARTWORK_IDS,
  CATALOG_CATEGORIES,
  CATALOG_PRODUCTS,
  type CatalogCategory,
  validateCatalog,
} from '@shop/catalog';

export const POWDER_CATEGORIES = CATALOG_CATEGORIES;
export type PowderCategory = CatalogCategory;
export type PowderProduct = (typeof POWDER_CATALOG)[number];

export const POWDER_CATALOG = CATALOG_PRODUCTS.map((product) => ({
  ...product,
  consumption_warning:
    product.consumptionClassification === 'food'
      ? null
      : product.consumptionClassification === 'caution'
        ? 'Handle with caution'
        : 'Not for consumption',
  visual: {
    label_color: String(product.imageSetId),
    powder_color: String(product.imageSetId),
    mark: 'PWDR',
    batch_code: `BATCH-${product.id}`,
  },
}));

export const POWDER_IMAGE_SET_IDS = CATALOG_ARTWORK_IDS;
export const validatePowderCatalog = validateCatalog;
