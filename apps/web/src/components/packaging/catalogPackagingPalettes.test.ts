import { describe, expect, it } from 'vitest';

import {
  CATALOG_PACKAGING_PALETTES,
  resolveCatalogPackagingPalette,
  type CatalogPackagingCategory,
} from './catalogPackagingPalettes';

/**
 * Ids mirror real canonical catalog records. `apps/web` does not depend on `@shop/catalog`
 * (dependency direction: `packages/catalog` -> `apps/api` only), so the id/category combinations
 * are reproduced here as literal fixtures rather than imported.
 */
const INDEX_COVERAGE: ReadonlyArray<readonly [CatalogPackagingCategory, readonly string[]]> = [
  ['Baking & Pantry', ['1', '2', '3', '4', '5']],
  ['Sports Nutrition', ['8', '9', '10', '11', '12']],
  ['Drinks', ['14', '15', '16', '17', '18']],
  ['Household & Cleaning', ['20', '21', '22', '23', '24']],
  ['Garden & Outdoors', ['27', '28', '29', '30', '31']],
  ['Trade & Creative Materials', ['33', '34', '35', '36', '37']],
];

const CATEGORIES = INDEX_COVERAGE.map(([category]) => category);

/**
 * Golden copy of the plan's Palette Matrix, in tuple order. Transcribed independently of the module
 * so a mistyped hex or a reordered tuple fails here instead of shipping as a silent colour change.
 * Trade order applies the plan erratum: Yellow Ochre is catalog id 40, not 49, so mineral-green
 * holds index 3 and yellow-ochre index 4.
 */
const PALETTE_MATRIX: ReadonlyArray<readonly [CatalogPackagingCategory, string, string, string]> = [
  ['Sports Nutrition', 'forest-mint', '#3f635b', '#b8d8c0'],
  ['Sports Nutrition', 'navy-sky', '#304b6a', '#a9cbe8'],
  ['Sports Nutrition', 'plum-berry', '#5c426d', '#d6a6c9'],
  ['Sports Nutrition', 'burgundy-rose', '#6a3e46', '#d8a7a9'],
  ['Sports Nutrition', 'bronze-oat', '#6b5538', '#d8c59b'],
  ['Baking & Pantry', 'rust-flour', '#7a4a2d', '#e8dcc1'],
  ['Baking & Pantry', 'cocoa-cacao', '#563b32', '#8d654f'],
  ['Baking & Pantry', 'olive-pistachio', '#59613b', '#c9d19c'],
  ['Baking & Pantry', 'plum-berry', '#684453', '#d2a0af'],
  ['Baking & Pantry', 'navy-corn', '#3e536b', '#e7cb77'],
  ['Drinks', 'teal-aqua', '#24606d', '#a9d8db'],
  ['Drinks', 'espresso-latte', '#4a352f', '#a67c62'],
  ['Drinks', 'berry-blush', '#6b3859', '#d79ab8'],
  ['Drinks', 'citrus-leaf', '#4e6034', '#d9d56e'],
  ['Drinks', 'indigo-ice', '#3d4674', '#a7b8e3'],
  ['Household & Cleaning', 'navy-foam', '#1b4a68', '#a9dce8'],
  ['Household & Cleaning', 'teal-mint', '#245c59', '#a7d5cd'],
  ['Household & Cleaning', 'violet-lilac', '#4f4770', '#c2b8df'],
  ['Household & Cleaning', 'charcoal-mist', '#3e4648', '#c5cfd0'],
  ['Household & Cleaning', 'pine-sage', '#315846', '#b3d1b6'],
  ['Garden & Outdoors', 'forest-leaf', '#2c5130', '#9ebb72'],
  ['Garden & Outdoors', 'earth-straw', '#5a4530', '#c7a46a'],
  ['Garden & Outdoors', 'moss-seed', '#475638', '#a8b486'],
  ['Garden & Outdoors', 'clay-terracotta', '#6a4638', '#c98565'],
  ['Garden & Outdoors', 'slate-eucalyptus', '#3e5550', '#9bc2b4'],
  ['Trade & Creative Materials', 'charcoal-mineral', '#26292c', '#e8e6df'],
  ['Trade & Creative Materials', 'oxide-red', '#623a30', '#b5543c'],
  ['Trade & Creative Materials', 'ultramarine-blue', '#293f6b', '#5878c5'],
  ['Trade & Creative Materials', 'mineral-green', '#345448', '#73a68e'],
  ['Trade & Creative Materials', 'yellow-ochre', '#624f28', '#c89b3c'],
];

describe('CATALOG_PACKAGING_PALETTES', () => {
  it('defines exactly six categories with exactly five schemes each', () => {
    expect(Object.keys(CATALOG_PACKAGING_PALETTES).sort()).toEqual([...CATEGORIES].sort());
    for (const category of CATEGORIES) {
      expect(CATALOG_PACKAGING_PALETTES[category]).toHaveLength(5);
    }
  });

  it.each(
    PALETTE_MATRIX.map(
      ([category, key, ink, pigment], row) => [category, row % 5, key, ink, pigment] as const,
    ),
  )('matches the plan matrix for %s index %i (%s)', (category, index, key, ink, pigment) => {
    expect(CATALOG_PACKAGING_PALETTES[category][index]).toEqual({ key, ink, pigment });
  });

  it('keeps keys and (ink, pigment) pairs unique within each category', () => {
    for (const category of CATEGORIES) {
      const palettes = CATALOG_PACKAGING_PALETTES[category];
      const keys = palettes.map((palette) => palette.key);
      const pairs = palettes.map((palette) => `${palette.ink}|${palette.pigment}`);
      expect(new Set(keys).size).toBe(palettes.length);
      expect(new Set(pairs).size).toBe(palettes.length);
    }
  });
});

describe('resolveCatalogPackagingPalette', () => {
  it('resolves the same product identically on repeated calls', () => {
    const product = { id: '12', category: 'Sports Nutrition' };
    expect(resolveCatalogPackagingPalette(product)).toEqual(
      resolveCatalogPackagingPalette(product),
    );
    expect(resolveCatalogPackagingPalette(product)).toBe(
      CATALOG_PACKAGING_PALETTES['Sports Nutrition'][1],
    );
  });

  it.each(INDEX_COVERAGE)('covers all five %s schemes across canonical ids', (category, ids) => {
    // Ids are compared as a set, not in order: each five-id run starts at whatever
    // `(id - 1) % 5` index its first canonical id lands on, so only the coverage is fixed.
    const resolved = ids.map((id) => resolveCatalogPackagingPalette({ id, category }));
    expect([...resolved].sort((a, b) => (a?.key ?? '').localeCompare(b?.key ?? ''))).toEqual(
      [...CATALOG_PACKAGING_PALETTES[category]].sort((a, b) => a.key.localeCompare(b.key)),
    );
    expect(new Set(resolved.map((palette) => palette?.key)).size).toBe(5);
  });

  it('resolves the same id through each category own palette', () => {
    const sports = resolveCatalogPackagingPalette({ id: '36', category: 'Sports Nutrition' });
    const trade = resolveCatalogPackagingPalette({
      id: '36',
      category: 'Trade & Creative Materials',
    });
    expect(sports?.key).toBe('forest-mint');
    expect(trade?.key).toBe('charcoal-mineral');
  });

  // Ids are the canonical Trade pigment records: Titanium White 36, Iron Oxide Red 37,
  // Ultramarine Blue 38, Yellow Ochre 40 (the plan text's 49 was an erratum; id 49 is Bentonite
  // Clay), so the tuple places mineral-green at index 3 and yellow-ochre at index 4.
  it.each([
    ['36', 'charcoal-mineral'],
    ['37', 'oxide-red'],
    ['38', 'ultramarine-blue'],
    ['40', 'yellow-ochre'],
  ])('pins Trade pigment id %s to %s', (id, key) => {
    expect(
      resolveCatalogPackagingPalette({ id, category: 'Trade & Creative Materials' })?.key,
    ).toBe(key);
  });

  it('returns undefined for an unknown category', () => {
    expect(
      resolveCatalogPackagingPalette({ id: '1', category: 'Unlisted Category' }),
    ).toBeUndefined();
    expect(resolveCatalogPackagingPalette({ id: '1', category: '' })).toBeUndefined();
    expect(resolveCatalogPackagingPalette({ id: '1', category: 'drinks' })).toBeUndefined();
  });

  it.each(['toString', 'constructor', 'hasOwnProperty', '__proto__'])(
    'returns undefined for inherited object member %j used as a category',
    (category) => {
      expect(resolveCatalogPackagingPalette({ id: '1', category })).toBeUndefined();
    },
  );

  it.each([
    '0',
    '-1',
    '+1',
    '1.5',
    'abc',
    '',
    ' 1',
    '1 ',
    '01',
    '007',
    'powdered-water-1',
    'NaN',
    '1e3',
    // Beyond the nine-digit bound: `Number()` would round or reach exponent form, so the resolved
    // scheme would stop following from the literal id.
    '9007199254740993',
    '100000000000000000000',
  ])('returns undefined for invalid id %j', (id) => {
    expect(resolveCatalogPackagingPalette({ id, category: 'Drinks' })).toBeUndefined();
  });
});
