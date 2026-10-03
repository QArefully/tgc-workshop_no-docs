import { bakingPantryProducts } from './categories/bakingPantry.js';
import { drinksProducts } from './categories/drinks.js';
import { gardenOutdoorsProducts } from './categories/gardenOutdoors.js';
import { householdCleaningProducts } from './categories/householdCleaning.js';
import { sportsNutritionProducts } from './categories/sportsNutrition.js';
import { tradeCreativeProducts } from './categories/tradeCreative.js';
import type { CatalogProduct } from './model.js';

export const CATALOG_PRODUCTS = [
  ...bakingPantryProducts,
  ...sportsNutritionProducts,
  ...drinksProducts,
  ...householdCleaningProducts,
  ...gardenOutdoorsProducts,
  ...tradeCreativeProducts,
] as const satisfies readonly CatalogProduct[];

export const CATALOG_ARTWORK_IDS = CATALOG_PRODUCTS.map((product) => product.imageSetId);
export const catalogProductById = new Map<number, CatalogProduct>(
  CATALOG_PRODUCTS.map((product) => [product.id, product]),
);
export const catalogProductBySlug = new Map<string, CatalogProduct>(
  CATALOG_PRODUCTS.map((product) => [product.slug, product]),
);
export const catalogProductByImageSetId = new Map<string, CatalogProduct>(
  CATALOG_PRODUCTS.map((product) => [product.imageSetId, product]),
);
