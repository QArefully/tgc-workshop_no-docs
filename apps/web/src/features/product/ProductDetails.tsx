import type { CategoryFacts } from '@shop/contracts/products';
import { productMessages } from '@shop/localisation/messages/product';
import { useLocalisation } from '@/i18n/LocaleContext';

interface ProductDetailsProps {
  description: string;
  categoryFacts: CategoryFacts;
}

function formatFactValue(value: unknown, notSpecified = 'Not specified'): string {
  if (value === null || value === undefined) return notSpecified;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  if (Array.isArray(value))
    return value.map((entry) => formatFactValue(entry, notSpecified)).join(', ');
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${formatFactValue(v, notSpecified)}`)
      .join('\u00A0\u00B7 ');
  }
  if (typeof value === 'boolean' || typeof value === 'bigint' || typeof value === 'symbol') {
    return value.toString();
  }
  return notSpecified;
}

function factDisplayPairs(
  facts: CategoryFacts,
  labelFor: (key: keyof typeof productMessages) => string,
  notSpecified: string,
): { label: string; value: string }[] {
  const pairs: { label: string; value: string }[] = [];

  const baseKeys: { key: string; labelKey: keyof typeof productMessages }[] = [
    { key: 'texture', labelKey: 'product.texture' },
    { key: 'colour', labelKey: 'product.colour' },
    { key: 'source', labelKey: 'product.source' },
    { key: 'intendedUse', labelKey: 'product.intendedUse' },
    { key: 'storage', labelKey: 'product.storage' },
  ];

  for (const { key, labelKey } of baseKeys) {
    if (key in facts) {
      pairs.push({
        label: labelFor(labelKey),
        value: formatFactValue((facts as Record<string, unknown>)[key], notSpecified),
      });
    }
  }

  const extensionKeys: { key: string; labelKey: keyof typeof productMessages }[] = [
    { key: 'ingredients', labelKey: 'product.ingredients' },
    { key: 'allergens', labelKey: 'product.allergens' },
    { key: 'nutrition', labelKey: 'product.nutrition' },
    { key: 'servingSize', labelKey: 'product.servingSize' },
    { key: 'dietaryAttributes', labelKey: 'product.dietaryAttributes' },
    { key: 'flavour', labelKey: 'product.flavour' },
    { key: 'servings', labelKey: 'product.servings' },
    { key: 'proteinPerServing', labelKey: 'product.proteinPerServing' },
    { key: 'carbsPerServing', labelKey: 'product.carbsPerServing' },
    { key: 'npk', labelKey: 'product.npk' },
    { key: 'coverage', labelKey: 'product.coverage' },
    { key: 'application', labelKey: 'product.application' },
    { key: 'handling', labelKey: 'product.handlingFact' },
    { key: 'surfaces', labelKey: 'product.surfaces' },
    { key: 'dosage', labelKey: 'product.dosage' },
    { key: 'hazardStatement', labelKey: 'product.hazardStatement' },
    { key: 'composition', labelKey: 'product.composition' },
    { key: 'waterRatio', labelKey: 'product.waterRatio' },
    { key: 'settingTime', labelKey: 'product.settingTime' },
    { key: 'ppe', labelKey: 'product.ppe' },
    { key: 'approvedApplication', labelKey: 'product.approvedApplication' },
    { key: 'cleanup', labelKey: 'product.cleanup' },
    { key: 'colourProfile', labelKey: 'product.colourProfile' },
    { key: 'particleAppearance', labelKey: 'product.particleAppearance' },
  ];

  for (const { key, labelKey } of extensionKeys) {
    if (key in facts) {
      const val = (facts as Record<string, unknown>)[key];
      pairs.push({ label: labelFor(labelKey), value: formatFactValue(val, notSpecified) });
    }
  }

  return pairs;
}

export function ProductDetails({ description, categoryFacts }: ProductDetailsProps) {
  const { translate } = useLocalisation();
  const notSpecified = translate(productMessages, 'product.notSpecified');
  const factPairs = factDisplayPairs(
    categoryFacts,
    (key) => translate(productMessages, key),
    notSpecified,
  );

  return (
    <section
      aria-labelledby="product-details-heading"
      className="rounded-2xl border bg-surface-raised p-6 sm:p-8"
    >
      <p className="section-eyebrow">{translate(productMessages, 'product.materialFacts')}</p>
      <h2 id="product-details-heading" className="mt-2 text-2xl font-semibold tracking-tight">
        {translate(productMessages, 'product.whatContains')}
      </h2>
      {description.trim() && (
        <p className="mt-4 max-w-3xl leading-7 text-muted-foreground">{description}</p>
      )}

      {factPairs.length > 0 && (
        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          {factPairs.map((pair) => (
            <div key={pair.label}>
              <dt className="text-sm font-semibold text-foreground">{pair.label}</dt>
              <dd className="mt-1 text-sm text-muted-foreground">{pair.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
