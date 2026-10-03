import type { CatalogProduct } from '@shop/catalog';

export const CATALOG_SPECIFICATION_GROUPS = [
  { key: 'appearance', label: 'Appearance', order: 1 },
  { key: 'origin-and-use', label: 'Origin and use', order: 2 },
  { key: 'pack-and-care', label: 'Pack and care', order: 3 },
] as const;
export type CatalogSpecificationGroup = (typeof CATALOG_SPECIFICATION_GROUPS)[number];
export type CatalogSpecificationGroupKey = CatalogSpecificationGroup['key'];

export const CATALOG_SPECIFICATION_DEFINITIONS = [
  { key: 'texture', label: 'Texture', group: 'appearance', order: 1, filterable: true },
  { key: 'colour', label: 'Colour', group: 'appearance', order: 2, filterable: true },
  { key: 'source', label: 'Source', group: 'origin-and-use', order: 1, filterable: true },
  {
    key: 'intended-use',
    label: 'Intended use',
    group: 'origin-and-use',
    order: 2,
    filterable: true,
  },
  {
    key: 'pack-weight',
    label: 'Pack weight',
    group: 'pack-and-care',
    order: 1,
    filterable: false,
  },
  {
    key: 'storage-guidance',
    label: 'Storage guidance',
    group: 'pack-and-care',
    order: 2,
    filterable: false,
  },
  {
    key: 'warning-class',
    label: 'Warning class',
    group: 'pack-and-care',
    order: 3,
    filterable: false,
  },
] as const;
export type CatalogSpecificationDefinition = (typeof CATALOG_SPECIFICATION_DEFINITIONS)[number];
export type CatalogSpecificationKey = CatalogSpecificationDefinition['key'];

export const catalogSpecificationByKey = new Map(
  CATALOG_SPECIFICATION_DEFINITIONS.map((definition) => [definition.key, definition]),
);

export type ResolvedCatalogSpecification = Readonly<{
  key: CatalogSpecificationKey;
  valueKey: string;
  displayValue: string;
  numericValue: number | null;
}>;

function specValueKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
}

function variantWeightLabel(grams: number): string {
  if (grams >= 1000 && grams % 1000 === 0) return `${grams / 1000} kg`;
  return `${grams} g`;
}

export function catalogProductSpecifications(
  product: CatalogProduct,
): readonly ResolvedCatalogSpecification[] {
  const facts = product.categoryFacts as Record<string, unknown>;
  const defaultVariant = product.variants.find((v) => v.sortOrder === 1 && v.active);
  const packWeightGrams = defaultVariant?.weightGrams ?? product.variants[0]?.weightGrams ?? 0;

  const rows: ResolvedCatalogSpecification[] = [];

  const textureValue =
    typeof facts.texture === 'string' && facts.texture.trim() ? facts.texture.trim() : null;
  if (textureValue) {
    rows.push({
      key: 'texture',
      valueKey: specValueKey(textureValue),
      displayValue: textureValue,
      numericValue: null,
    });
  }

  const colourValue =
    typeof facts.colour === 'string' && facts.colour.trim() ? facts.colour.trim() : null;
  if (colourValue) {
    rows.push({
      key: 'colour',
      valueKey: specValueKey(colourValue),
      displayValue: colourValue,
      numericValue: null,
    });
  }

  const sourceValue =
    typeof facts.source === 'string' && facts.source.trim() ? facts.source.trim() : null;
  if (sourceValue) {
    rows.push({
      key: 'source',
      valueKey: specValueKey(sourceValue),
      displayValue: sourceValue,
      numericValue: null,
    });
  }

  const intendedUseValue =
    typeof facts.intendedUse === 'string' && facts.intendedUse.trim()
      ? facts.intendedUse.trim()
      : null;
  if (intendedUseValue) {
    rows.push({
      key: 'intended-use',
      valueKey: specValueKey(intendedUseValue),
      displayValue: intendedUseValue,
      numericValue: null,
    });
  }

  const weightLabel = variantWeightLabel(packWeightGrams);
  rows.push({
    key: 'pack-weight',
    valueKey: weightLabel.replace(/\s+/g, '-'),
    displayValue: weightLabel,
    numericValue: packWeightGrams,
  });

  const storageValue =
    typeof facts.storage === 'string' && facts.storage.trim() ? facts.storage.trim() : null;
  if (storageValue) {
    rows.push({
      key: 'storage-guidance',
      valueKey: specValueKey(storageValue),
      displayValue: storageValue,
      numericValue: null,
    });
  }

  const consumptionClassification = product.consumptionClassification;
  const warningLabel =
    consumptionClassification === 'food'
      ? 'None'
      : consumptionClassification === 'caution'
        ? 'Handle with caution'
        : 'Not for consumption';
  rows.push({
    key: 'warning-class',
    valueKey:
      consumptionClassification === 'food'
        ? 'none'
        : consumptionClassification === 'caution'
          ? 'handle-with-caution'
          : 'not-for-consumption',
    displayValue: warningLabel,
    numericValue: null,
  });

  return rows;
}
