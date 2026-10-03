import type {
  CatalogVariant,
  CategoryFacts,
  ConsumptionClassification,
  Product,
} from '@shop/contracts/products';

import { resolveCatalogPackagingPalette } from './catalogPackagingPalettes';
import { INKS, titleLines, type InkKey } from './svgText';

export type Vessel = 'food-bag' | 'kraft-sack' | 'woven-sack' | 'keg';
export type KegTone = 'corrosive' | 'mild';

/**
 * Colours used when no catalog palette resolves (unknown category, non-canonical id). Deliberately
 * neutral and internal: it keeps `PackagingSpec` total for hand-authored specs and for the
 * unresolved spec `ProductMedia` builds before deciding a branch. It never stands in for a category
 * scheme on a rendered catalog vessel -- `ProductMedia` gates every printed vessel, food and
 * heavy-duty alike, on a resolved palette and otherwise falls back to the generic artwork.
 */
export const NEUTRAL_PACKAGING_SCHEME = {
  schemeKey: 'neutral',
  pigment: '#d8d2c4',
} as const satisfies { schemeKey: string; pigment: string };

export interface PackagingSpec {
  vessel: Vessel;
  tone?: KegTone;
  /**
   * Stable kebab-case key of the decorative scheme this spec was printed from. Rendering surfaces
   * expose it for deterministic inspection; it never affects safety copy.
   */
  schemeKey: string;
  /** Decorative material colour for the vessel's pigment sample. Never a safety colour. */
  pigment: string;
  /**
   * `ink` is decorative and follows the resolved scheme; `alert` is safety-owned and always comes
   * from the category's {@link INKS} entry, so hazard treatments never vary with a scheme.
   */
  ink: { ink: string; alert: string };
  brand: string;
  titleLines: string[];
  sub: string;
  grade?: string;
  lot: string;
  netWeight?: string;
  hazard?: string;
  dose?: string;
  never?: string;
  yield?: string;
}

/** Vessel props shared by every non-food packaging component. */
export interface VesselArtworkProps {
  name: string;
  spec: PackagingSpec;
  ariaLabel?: string;
  className?: string;
}

export const PACKAGING_BRAND = 'QAREFULLY MATERIALS EXCHANGE';

const CATEGORY_PREFIX: Readonly<Record<string, string>> = {
  'Trade & Creative Materials': 'TCM',
  'Garden & Outdoors': 'GDN',
  'Household & Cleaning': 'HCL',
};

export type PackagingProductInput = Pick<Product, 'id' | 'name' | 'category'> & {
  consumptionClassification?: ConsumptionClassification;
  categoryFacts?: CategoryFacts;
  mixingGroup?: string | null;
};

interface ResolveInput {
  product: PackagingProductInput;
  variant?: Pick<CatalogVariant, 'sku' | 'label'>;
}

function hasCategoryFacts(
  product: PackagingProductInput,
): product is PackagingProductInput & Required<Pick<PackagingProductInput, 'categoryFacts'>> {
  return 'categoryFacts' in product;
}

/**
 * Short grade designation only. `TradeFacts.composition` and `CleaningFacts.dosage` are full-prose
 * fields (composition can run 80+ characters, dosage 90+) that overflow the vessel's short grade
 * slot and, for cleaning products, would otherwise duplicate the keg's separate DOSE line
 * (`doseFromFacts`) verbatim -- so neither is used as a grade source. `GardenFacts.npk` is a short
 * fixed-format designation (e.g. `10-10-10`) and stays. Shapes without a short designation fall
 * through to the mixing-group label in `resolvePackagingSpec`; per the omit-on-missing rule this
 * never fabricates a designation the catalog does not carry.
 */
function gradeFromFacts(facts: CategoryFacts | undefined): string | undefined {
  if (facts && 'npk' in facts) return facts.npk;
  return undefined;
}

function hazardFromFacts(
  facts: CategoryFacts | undefined,
  classification: ConsumptionClassification | undefined,
): string | undefined {
  if (facts) {
    if ('hazardStatement' in facts) return facts.hazardStatement;
    if ('handling' in facts) return facts.handling;
    if ('ppe' in facts && facts.ppe.length > 0) return facts.ppe.join(', ');
  }
  if (classification === 'caution') return 'Caution -- handle with protective equipment';
  if (classification === 'non-food') return 'Not for consumption';
  return undefined;
}

/**
 * Extracts an existing "Do not ..." / "Never ..." clause from a real hazard statement so the keg's
 * corrosive-tone warning band never prints text that was not already asserted about the product.
 */
function neverFromHazardStatement(hazardStatement: string | undefined): string | undefined {
  if (!hazardStatement) return undefined;
  const matches = hazardStatement.match(/(?:Do not|Never)[^.]*\.\s*/gi);
  return matches ? matches.join(' ').trim() : undefined;
}

function doseFromFacts(facts: CategoryFacts | undefined): string | undefined {
  if (facts && 'dosage' in facts) return facts.dosage;
  return undefined;
}

function yieldFromFacts(facts: CategoryFacts | undefined): string | undefined {
  if (facts && 'coverage' in facts) return facts.coverage;
  return undefined;
}

function mixingGroupLabel(mixingGroup: string | null | undefined): string | undefined {
  if (!mixingGroup) return undefined;
  return mixingGroup
    .split('-')
    .map((word) => (word.length > 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
}

function lotFor(
  product: PackagingProductInput,
  variant: Pick<CatalogVariant, 'sku' | 'label'> | undefined,
  categoryPrefix: string | undefined,
): string {
  if (variant?.sku) return variant.sku;
  return `${categoryPrefix ?? 'MAT'}-${product.id}`;
}

interface VesselSelection {
  vessel: Vessel;
  tone?: KegTone;
  inkKey?: InkKey;
}

/**
 * Vessel selection: category first, softened by `consumptionClassification` for the cleaning
 * category. Pure and total over every catalog category; unknown/food categories fall back to the
 * existing locked food bag. See plan `Decisions and Invariants` for the authoritative mapping.
 */
function selectVessel(
  category: string,
  classification: ConsumptionClassification | undefined,
): VesselSelection {
  switch (category) {
    case 'Trade & Creative Materials':
      return { vessel: 'kraft-sack', inkKey: 'trade' };
    case 'Garden & Outdoors':
      return { vessel: 'woven-sack', inkKey: 'garden' };
    case 'Household & Cleaning':
      // Missing classification defaults to the stronger corrosive tone rather than the softened
      // mild tone, so an unclassified cleaning product never under-states its hazard.
      return classification === 'non-food'
        ? { vessel: 'keg', tone: 'mild', inkKey: 'clean' }
        : { vessel: 'keg', tone: 'corrosive', inkKey: 'clean' };
    default:
      return { vessel: 'food-bag' };
  }
}

/**
 * Pure, total resolver from wire-available product fields to a printable packaging spec. No
 * network call, no randomness, no clock read -- the same product always resolves to the same
 * vessel. Every printed string traces to a catalog fact or `consumptionClassification`; a missing
 * source omits the field rather than fabricating copy.
 */
export function resolvePackagingSpec({ product, variant }: ResolveInput): PackagingSpec {
  const category = product.category;
  const classification = product.consumptionClassification;
  const { vessel, tone, inkKey } = selectVessel(category, classification);
  const categoryPrefix = CATEGORY_PREFIX[category];
  const facts = hasCategoryFacts(product) ? product.categoryFacts : undefined;
  const mixingGroup = hasCategoryFacts(product) ? product.mixingGroup : undefined;

  const grade = gradeFromFacts(facts) ?? mixingGroupLabel(mixingGroup);
  const hazard = vessel === 'food-bag' ? undefined : hazardFromFacts(facts, classification);
  const dose = vessel === 'keg' ? doseFromFacts(facts) : undefined;
  const never = tone === 'corrosive' ? neverFromHazardStatement(hazard) : undefined;
  const yieldText = vessel === 'woven-sack' ? yieldFromFacts(facts) : undefined;

  // Resolved once per spec so every surface (card, gallery, cart, comparison) prints the same
  // scheme for the same product. Safety `alert` stays on the category ink entry regardless.
  const palette = resolveCatalogPackagingPalette(product);
  const categoryInk = inkKey ? INKS[inkKey] : { ink: '#242522', alert: '#b0381a' };

  return {
    vessel,
    tone,
    schemeKey: palette?.key ?? NEUTRAL_PACKAGING_SCHEME.schemeKey,
    pigment: palette?.pigment ?? NEUTRAL_PACKAGING_SCHEME.pigment,
    ink: { ink: palette?.ink ?? categoryInk.ink, alert: categoryInk.alert },
    brand: PACKAGING_BRAND,
    titleLines: titleLines(product.name),
    sub: category,
    grade,
    lot: lotFor(product, variant, categoryPrefix),
    netWeight: variant?.label,
    hazard,
    dose,
    never,
    yield: yieldText,
  };
}
