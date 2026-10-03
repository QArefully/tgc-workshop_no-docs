import type { Product } from '@shop/contracts/products';

/**
 * One decorative packaging colour scheme. Safety colours (`ink.alert`, keg danger treatments) are
 * deliberately not part of a scheme -- see plan `Decisions and Invariants` 5 and 6.
 */
export interface CatalogPackagingPalette {
  /** Stable kebab-case identifier, unique within its category. */
  readonly key: string;
  /** Dark primary colour used for the label/band/printed decoration. */
  readonly ink: string;
  /** Secondary material colour used by the decorative pigment sample. */
  readonly pigment: string;
}

/**
 * The six recognized catalog category names as they appear on the wire in `Product.category`.
 * Declared locally rather than imported from `@shop/catalog`: the web app does not depend on that
 * package (dependency direction: `packages/catalog` -> `apps/api` only).
 */
export type CatalogPackagingCategory =
  | 'Sports Nutrition'
  | 'Baking & Pantry'
  | 'Drinks'
  | 'Household & Cleaning'
  | 'Garden & Outdoors'
  | 'Trade & Creative Materials';

type PaletteTuple = readonly [
  CatalogPackagingPalette,
  CatalogPackagingPalette,
  CatalogPackagingPalette,
  CatalogPackagingPalette,
  CatalogPackagingPalette,
];

/**
 * Exactly five schemes per category, entered verbatim from the plan's Palette Matrix. Values are
 * literal design decisions, not derived tokens -- do not re-derive or reorder them; the order fixes
 * which product id receives which scheme.
 */
export const CATALOG_PACKAGING_PALETTES = {
  'Sports Nutrition': [
    { key: 'forest-mint', ink: '#3f635b', pigment: '#b8d8c0' },
    { key: 'navy-sky', ink: '#304b6a', pigment: '#a9cbe8' },
    { key: 'plum-berry', ink: '#5c426d', pigment: '#d6a6c9' },
    { key: 'burgundy-rose', ink: '#6a3e46', pigment: '#d8a7a9' },
    { key: 'bronze-oat', ink: '#6b5538', pigment: '#d8c59b' },
  ],
  'Baking & Pantry': [
    { key: 'rust-flour', ink: '#7a4a2d', pigment: '#e8dcc1' },
    { key: 'cocoa-cacao', ink: '#563b32', pigment: '#8d654f' },
    { key: 'olive-pistachio', ink: '#59613b', pigment: '#c9d19c' },
    { key: 'plum-berry', ink: '#684453', pigment: '#d2a0af' },
    { key: 'navy-corn', ink: '#3e536b', pigment: '#e7cb77' },
  ],
  Drinks: [
    { key: 'teal-aqua', ink: '#24606d', pigment: '#a9d8db' },
    { key: 'espresso-latte', ink: '#4a352f', pigment: '#a67c62' },
    { key: 'berry-blush', ink: '#6b3859', pigment: '#d79ab8' },
    { key: 'citrus-leaf', ink: '#4e6034', pigment: '#d9d56e' },
    { key: 'indigo-ice', ink: '#3d4674', pigment: '#a7b8e3' },
  ],
  'Household & Cleaning': [
    { key: 'navy-foam', ink: '#1b4a68', pigment: '#a9dce8' },
    { key: 'teal-mint', ink: '#245c59', pigment: '#a7d5cd' },
    { key: 'violet-lilac', ink: '#4f4770', pigment: '#c2b8df' },
    { key: 'charcoal-mist', ink: '#3e4648', pigment: '#c5cfd0' },
    { key: 'pine-sage', ink: '#315846', pigment: '#b3d1b6' },
  ],
  'Garden & Outdoors': [
    { key: 'forest-leaf', ink: '#2c5130', pigment: '#9ebb72' },
    { key: 'earth-straw', ink: '#5a4530', pigment: '#c7a46a' },
    { key: 'moss-seed', ink: '#475638', pigment: '#a8b486' },
    { key: 'clay-terracotta', ink: '#6a4638', pigment: '#c98565' },
    { key: 'slate-eucalyptus', ink: '#3e5550', pigment: '#9bc2b4' },
  ],
  'Trade & Creative Materials': [
    // Plan erratum: the matrix listed yellow-ochre before mineral-green on the claim that Yellow
    // Ochre is product id 49. The canonical catalog record is id 40
    // (`packages/catalog/src/categories/tradeCreative.ts`), which lands on index 4, so the two
    // schemes are swapped here to keep the intended pigment-to-scheme pairing. Hex values unchanged.
    { key: 'charcoal-mineral', ink: '#26292c', pigment: '#e8e6df' },
    { key: 'oxide-red', ink: '#623a30', pigment: '#b5543c' },
    { key: 'ultramarine-blue', ink: '#293f6b', pigment: '#5878c5' },
    { key: 'mineral-green', ink: '#345448', pigment: '#73a68e' },
    { key: 'yellow-ochre', ink: '#624f28', pigment: '#c89b3c' },
  ],
} as const satisfies Record<CatalogPackagingCategory, PaletteTuple>;

/**
 * Positive integer ids only, bounded to nine digits. The bound keeps `Number(id)` exact: beyond
 * `Number.MAX_SAFE_INTEGER` the parse rounds (and exponent-sized literals collapse), so the scheme
 * would no longer follow from the literal id.
 */
const POSITIVE_INTEGER_ID = /^[1-9][0-9]{0,8}$/;

function isRecognizedCategory(category: string): category is CatalogPackagingCategory {
  // `Object.hasOwn`, not `in`: `in` also matches inherited members, so 'toString' or 'constructor'
  // would pass as a category and then index to `undefined`.
  return Object.hasOwn(CATALOG_PACKAGING_PALETTES, category);
}

/**
 * Deterministically selects a decorative scheme from a product's category and numeric id. Pure: no
 * randomness, clock, browser storage, module mutation, or dependence on API response ordering, so
 * the same product renders the same scheme in cards, gallery, cart, comparison, and after a reset.
 *
 * Returns `undefined` for an unrecognized category, a non-positive-integer id, or a missing
 * palette; callers continue to the generic artwork fallback rather than inventing a colour.
 */
export function resolveCatalogPackagingPalette(
  product: Pick<Product, 'id' | 'category'>,
): CatalogPackagingPalette | undefined {
  if (!isRecognizedCategory(product.category)) return undefined;
  if (!POSITIVE_INTEGER_ID.test(product.id)) return undefined;
  const palettes = CATALOG_PACKAGING_PALETTES[product.category];
  return palettes[(Number(product.id) - 1) % palettes.length];
}
