import type { Product, ProductWithVariants } from '@shop/contracts/products';
import { describe, expect, it } from 'vitest';

import { resolveFoodBagArtwork } from '../ProductMedia';
import { resolveCatalogPackagingPalette } from './catalogPackagingPalettes';
import { NEUTRAL_PACKAGING_SCHEME, resolvePackagingSpec } from './packagingSpec';
import { INKS } from './svgText';

/**
 * Fixtures mirror real catalog id/category/mixingGroup/consumptionClassification combinations
 * from `packages/catalog/src/categories/{tradeCreative,gardenOutdoors,householdCleaning}.ts`.
 * `apps/web` does not depend on `@shop/catalog` (dependency direction: `packages/catalog` ->
 * `apps/api` only), so the combinations are reproduced here as literal fixtures rather than
 * imported.
 */

const baseProduct = (overrides: Partial<Product> = {}): Product => ({
  id: '1',
  name: 'Fixture Product',
  description: 'Fixture description',
  priceCents: 1000,
  imageSetId: 'fixture',
  category: 'Sports Nutrition',
  stock: 10,
  slug: 'fixture-product',
  salesCount: 0,
  createdAt: '2026-07-14T00:00:00.000Z',
  available: true,
  tags: [],
  specificationGroups: [],
  availability: 'in_stock',
  backorderable: false,
  backorderLeadDays: null,
  ...overrides,
});

const withVariants = (
  overrides: Partial<ProductWithVariants>,
  product: Product = baseProduct(overrides),
): ProductWithVariants => ({
  ...product,
  variants: [],
  defaultVariantId: 1,
  categoryFacts: {
    texture: 't',
    colour: 'c',
    source: 's',
    intendedUse: 'u',
    storage: 'st',
    consumptionClassification: 'caution',
  },
  consumptionClassification: 'caution',
  mixingGroup: null,
  priceRange: { min: 1000, max: 1000 },
  baseAvailability: 'in_stock',
  ...overrides,
});

describe('resolvePackagingSpec selector matrix', () => {
  it('resolves the three food categories and an unknown category to the food bag', () => {
    for (const category of ['Sports Nutrition', 'Baking & Pantry', 'Drinks', 'Unmapped Category']) {
      const spec = resolvePackagingSpec({ product: baseProduct({ category }) });
      expect(spec.vessel).toBe('food-bag');
    }
  });

  it('resolves Trade & Creative Materials (id 33, Portland Cement, cementitious-materials, caution) to A', () => {
    const spec = resolvePackagingSpec({
      product: withVariants({
        id: '33',
        name: 'Portland Cement',
        category: 'Trade & Creative Materials',
        consumptionClassification: 'caution',
        mixingGroup: 'cementitious-materials',
        categoryFacts: {
          texture: 'Fine powder',
          colour: 'Grey',
          source: 'Calcined limestone and clay',
          intendedUse: 'Concrete',
          storage: 'Dry',
          consumptionClassification: 'caution',
          // Real catalog value (`stone-dust`, `tradeCreative.ts:370-371`) -- the longest
          // `composition` string in the category, used here as the worst case to prove
          // `composition` is never used as the grade source (it would overflow the vessel's
          // short grade slot; see R4-F1).
          composition:
            'Crushed granite aggregate, particle size 0-5 mm, containing quartz, feldspar, and mica',
          waterRatio: '0.4L/kg',
          coverage: '0.013 m3',
          settingTime: '45-60 min',
          ppe: ['Dust mask (P2/P3)', 'Safety glasses'],
        },
      }),
    });
    expect(spec.vessel).toBe('kraft-sack');
    // `TradeFacts` has no short designation field, so grade falls through to the mixing-group
    // label rather than the long-prose `composition` string.
    expect(spec.grade).toBe('Cementitious Materials');
    expect(spec.grade).not.toContain('Crushed granite');
  });

  it('resolves Trade & Creative Materials absorbent (id 49, Bentonite Clay, absorbents, non-food) to A', () => {
    const spec = resolvePackagingSpec({
      product: withVariants({
        id: '49',
        name: 'Bentonite Clay',
        category: 'Trade & Creative Materials',
        consumptionClassification: 'non-food',
        mixingGroup: 'absorbents',
        categoryFacts: {
          texture: 'Fine powder',
          colour: 'Grey',
          source: 'Mined clay',
          intendedUse: 'Sealing',
          storage: 'Dry',
          consumptionClassification: 'non-food',
          composition: 'Sodium montmorillonite > 85%',
          waterRatio: '5x weight',
          coverage: '5 m2',
          settingTime: 'Hydrates in minutes',
          ppe: ['Dust mask', 'Gloves'],
        },
      }),
    });
    expect(spec.vessel).toBe('kraft-sack');
  });

  it('resolves Garden & Outdoors (id 28, Bone Meal, garden-treatment, non-food) to B', () => {
    const spec = resolvePackagingSpec({
      product: withVariants({
        id: '28',
        name: 'Bone Meal',
        category: 'Garden & Outdoors',
        consumptionClassification: 'non-food',
        mixingGroup: 'garden-treatment',
        categoryFacts: {
          texture: 'Coarse powder',
          colour: 'Tan',
          source: 'Steamed bones',
          intendedUse: 'Fertiliser',
          storage: 'Dry',
          consumptionClassification: 'non-food',
          npk: '3-15-0',
          coverage: '20 m2',
          application: 'Work into soil',
          handling: 'Wear gloves. Wash hands after use.',
        },
      }),
    });
    expect(spec.vessel).toBe('woven-sack');
    expect(spec.grade).toBe('3-15-0');
    expect(spec.hazard).toBe('Wear gloves. Wash hands after use.');
  });

  it('resolves Household & Cleaning caution (id 44, Drain Unblocker, cleaning, caution) to F corrosive', () => {
    const spec = resolvePackagingSpec({
      product: withVariants({
        id: '44',
        name: 'Drain Unblocker Powder',
        category: 'Household & Cleaning',
        consumptionClassification: 'caution',
        mixingGroup: 'cleaning',
        categoryFacts: {
          texture: 'Granular',
          colour: 'White',
          source: 'Sodium hydroxide',
          intendedUse: 'Drains',
          storage: 'Locked cabinet',
          consumptionClassification: 'caution',
          surfaces: ['Metal pipes'],
          // Real catalog value (`drain-unblocker-powder`, `householdCleaning.ts:361-362`), full
          // sentence -- not the previous hand-truncated 22-char stand-in. Proves the DOSE line
          // renders the real worst-case length and that `grade` no longer duplicates it.
          dosage:
            'Pour 50 g into drain. Add 250 ml cold water carefully. Leave for 30 minutes. Flush with water.',
          // Full real catalog value (`drain-unblocker-powder`, `householdCleaning.ts:363-364`),
          // not the previously hand-truncated two-sentence stand-in -- proves `hazard` renders the
          // real worst-case length and `never` still extracts only the "Do not"/"Never" clause.
          hazardStatement:
            'Causes severe skin burns and eye damage. Reacts violently with water, releasing flammable hydrogen gas. Never use with hot water or other chemicals.',
          handling: 'Wear protective gloves, eye protection, and face shield.',
        },
      }),
    });
    expect(spec.vessel).toBe('keg');
    expect(spec.tone).toBe('corrosive');
    expect(spec.hazard).toContain('Causes severe skin burns');
    expect(spec.hazard).toContain('flammable hydrogen gas');
    expect(spec.never).toBe('Never use with hot water or other chemicals.');
    expect(spec.dose).toBe(
      'Pour 50 g into drain. Add 250 ml cold water carefully. Leave for 30 minutes. Flush with water.',
    );
    // `CleaningFacts.dosage` feeds `dose` only; `grade` falls through to the mixing-group label,
    // so the keg never prints the same sentence twice (R4-F1).
    expect(spec.grade).toBe('Cleaning');
    expect(spec.grade).not.toBe(spec.dose);
  });

  it('resolves Household & Cleaning absorbent (id 1038, Carpet Cleaner, absorbents, non-food) to F mild', () => {
    const spec = resolvePackagingSpec({
      product: withVariants({
        id: '1038',
        name: 'Carpet Cleaner Powder',
        category: 'Household & Cleaning',
        consumptionClassification: 'non-food',
        mixingGroup: 'absorbents',
        categoryFacts: {
          texture: 'Fine powder',
          colour: 'White',
          source: 'Zeolites',
          intendedUse: 'Carpet cleaning',
          storage: 'Dry',
          consumptionClassification: 'non-food',
          surfaces: ['Carpet'],
          dosage: 'Sprinkle liberally over carpet area.',
          hazardStatement: 'May cause dust irritation. Avoid breathing powder.',
          handling: 'Open windows for ventilation.',
        },
      }),
    });
    expect(spec.vessel).toBe('keg');
    expect(spec.tone).toBe('mild');
    expect(spec.hazard).toBe('May cause dust irritation. Avoid breathing powder.');
    // Mild tone never prints a "never" / DANGER band, even when the hazard statement contains one.
    expect(spec.never).toBeUndefined();
  });

  it('resolves Household & Cleaning absorbent (id 1041, Shoe Deodorising, absorbents, non-food) to F mild', () => {
    const spec = resolvePackagingSpec({
      product: withVariants({
        id: '1041',
        name: 'Shoe Deodorising Powder',
        category: 'Household & Cleaning',
        consumptionClassification: 'non-food',
        mixingGroup: 'absorbents',
        categoryFacts: {
          texture: 'Fine powder',
          colour: 'White',
          source: 'Sodium bicarbonate',
          intendedUse: 'Shoe odour control',
          storage: 'Dry',
          consumptionClassification: 'non-food',
          surfaces: ['Leather'],
          dosage: 'Sprinkle one teaspoon per shoe.',
          hazardStatement: 'May cause dust irritation. Avoid getting powder into eyes.',
          handling: 'Avoid breathing dust when sprinkling.',
        },
      }),
    });
    expect(spec.vessel).toBe('keg');
    expect(spec.tone).toBe('mild');
  });

  it('defaults Household & Cleaning to corrosive when consumptionClassification is missing', () => {
    const spec = resolvePackagingSpec({
      product: baseProduct({
        category: 'Household & Cleaning',
        consumptionClassification: undefined,
      }),
    });
    expect(spec.vessel).toBe('keg');
    expect(spec.tone).toBe('corrosive');
  });

  it('omits grade, hazard, netWeight, dose and yield when no source data is available', () => {
    const spec = resolvePackagingSpec({
      product: baseProduct({
        category: 'Trade & Creative Materials',
        consumptionClassification: 'caution',
      }),
    });
    expect(spec.grade).toBeUndefined();
    expect(spec.netWeight).toBeUndefined();
    expect(spec.dose).toBeUndefined();
    expect(spec.yield).toBeUndefined();
    // Hazard still falls back to the consumption classification, never fabricated beyond it.
    expect(spec.hazard).toBe('Caution -- handle with protective equipment');
  });

  it('sources the lot from the resolved variant SKU when provided, else a category-prefixed id', () => {
    const withSku = resolvePackagingSpec({
      product: baseProduct({ id: '33', category: 'Trade & Creative Materials' }),
      variant: { sku: 'TCM-0033-001', label: '25 kg Sack' },
    });
    expect(withSku.lot).toBe('TCM-0033-001');
    expect(withSku.netWeight).toBe('25 kg Sack');

    const withoutSku = resolvePackagingSpec({
      product: baseProduct({ id: '33', category: 'Trade & Creative Materials' }),
    });
    expect(withoutSku.lot).toBe('TCM-33');
    expect(withoutSku.netWeight).toBeUndefined();
  });

  it('every vessel prints the unified brand string', () => {
    const categories = [
      'Sports Nutrition',
      'Trade & Creative Materials',
      'Garden & Outdoors',
      'Household & Cleaning',
    ];
    for (const category of categories) {
      const spec = resolvePackagingSpec({ product: baseProduct({ category }) });
      expect(spec.brand).toBe('QAREFULLY MATERIALS EXCHANGE');
    }
  });
});

describe('resolvePackagingSpec decorative scheme', () => {
  it('varies decorative ink and pigment across a category while the safety alert stays constant', () => {
    const specs = ['33', '34', '35', '36', '37'].map((id) =>
      resolvePackagingSpec({
        product: baseProduct({ id, category: 'Trade & Creative Materials' }),
      }),
    );

    expect(new Set(specs.map((spec) => spec.schemeKey)).size).toBe(5);
    expect(new Set(specs.map((spec) => spec.pigment)).size).toBe(5);
    expect(new Set(specs.map((spec) => spec.ink.ink)).size).toBe(5);
    // Safety colour is owned by the category INKS entry and never follows a decorative scheme.
    expect(new Set(specs.map((spec) => spec.ink.alert))).toEqual(new Set(['#b0381a']));
  });

  it('pins the known Trade pigment products to their catalog schemes', () => {
    const spec = resolvePackagingSpec({
      product: baseProduct({ id: '37', category: 'Trade & Creative Materials' }),
    });
    expect(spec.schemeKey).toBe('oxide-red');
    expect(spec.pigment).toBe('#b5543c');
    expect(spec.ink.ink).toBe('#623a30');
  });

  it('resolves the same id through its own category palette', () => {
    const garden = resolvePackagingSpec({
      product: baseProduct({ id: '3', category: 'Garden & Outdoors' }),
    });
    const household = resolvePackagingSpec({
      product: baseProduct({ id: '3', category: 'Household & Cleaning' }),
    });

    expect(garden.schemeKey).toBe('moss-seed');
    expect(household.schemeKey).toBe('violet-lilac');
    expect(garden.pigment).not.toBe(household.pigment);
  });

  it('keeps a single constant safety alert across all five corrosive keg schemes', () => {
    const specs = ['20', '21', '22', '23', '24'].map((id) =>
      resolvePackagingSpec({
        product: baseProduct({
          id,
          category: 'Household & Cleaning',
          consumptionClassification: 'caution',
        }),
      }),
    );

    expect(new Set(specs.map((spec) => spec.schemeKey)).size).toBe(5);
    expect(new Set(specs.map((spec) => spec.pigment)).size).toBe(5);
    expect(new Set(specs.map((spec) => spec.ink.ink)).size).toBe(5);
    // Safety-critical: the keg's danger colour and corrosive tone are owned by the category, so
    // neither may follow the decorative scheme (plan invariant 6).
    expect(new Set(specs.map((spec) => spec.ink.alert))).toEqual(new Set([INKS.clean.alert]));
    expect(new Set(specs.map((spec) => spec.tone))).toEqual(new Set(['corrosive']));
  });

  it('keeps the neutral internal scheme out of every rendered vessel', () => {
    const unknownProduct = baseProduct({ category: 'Unmapped Category' });
    const invalidIdProduct = baseProduct({ id: 'powdered-water-1', category: 'Garden & Outdoors' });

    for (const product of [unknownProduct, invalidIdProduct]) {
      const spec = resolvePackagingSpec({ product });
      expect(spec.schemeKey).toBe(NEUTRAL_PACKAGING_SCHEME.schemeKey);
      expect(spec.pigment).toBe(NEUTRAL_PACKAGING_SCHEME.pigment);
      // The neutral scheme stays internal: no palette resolves, and `ProductMedia` gates every
      // printed vessel -- including the non-food woven sack the second fixture selects -- on a
      // resolved palette, so both fixtures render the generic artwork instead (plan invariant 7).
      expect(resolveCatalogPackagingPalette(product)).toBeUndefined();
    }

    const invalidId = resolvePackagingSpec({ product: invalidIdProduct });
    // The category default ink is retained rather than replaced by an invented colour.
    expect(invalidId.ink).toEqual({ ink: '#2c5130', alert: '#9d5416' });
  });

  it('agrees with the food-bag artwork carrier on scheme and pigment', () => {
    // `ProductMedia` draws the food bag from `spec`; `resolveFoodBagArtwork` still carries the same
    // palette for category metadata and the palette-presence gate. Pinning the two together keeps
    // the second carrier from silently drifting away from what is rendered.
    for (const [id, category] of [
      ['8', 'Sports Nutrition'],
      ['2', 'Baking & Pantry'],
      ['15', 'Drinks'],
    ] as const) {
      const product = baseProduct({ id, category });
      const spec = resolvePackagingSpec({ product });
      const artwork = resolveFoodBagArtwork(product);

      expect(spec.schemeKey).toBe(artwork?.schemeKey);
      expect(spec.pigment).toBe(artwork?.powderAccent);
      expect(spec.ink.ink).toBe(artwork?.accent);
    }
  });

  it('is stable across repeated resolutions of the same product', () => {
    const product = baseProduct({ id: '9', category: 'Sports Nutrition' });
    expect(resolvePackagingSpec({ product })).toEqual(resolvePackagingSpec({ product }));
  });
});
