import type { CatalogVariant } from '@shop/contracts/products';
import type {
  CustomBlendSnapshot,
  ResolvedCustomBlendSnapshot,
} from '@shop/contracts/custom-blends';
import type { Country } from '@shop/contracts/country';
import { formatNumber, translate } from '@shop/localisation';
import { customBlendMessages } from '@shop/localisation/messages/customBlend';

import { PackagingArtwork } from '@/components/packaging/PackagingArtwork';
import { useLocalisation } from '@/i18n/LocaleContext';
import {
  resolvePackagingSpec,
  type PackagingProductInput,
  type Vessel,
} from '@/components/packaging/packagingSpec';

/**
 * Stable diagnostic key for the one Custom Blend livery. A blend is never printed from a catalog
 * colour scheme, so this key is fixed rather than resolved per product.
 */
export const CUSTOM_BLEND_SCHEME_KEY = 'custom-blend';

/**
 * Fixed charcoal decoration. Deliberately constant: composition must not be readable from the
 * vessel, so no ingredient, percentage or mixing group may reach a colour here.
 */
export const CUSTOM_BLEND_PIGMENT = '#3a3d39';
export const CUSTOM_BLEND_INK = '#1e211d';

/** Printed spec band. Identifies the line as configured without naming its composition. */
/**
 * Shared disclosure copy, so cart, checkout and order detail cannot drift apart.
 *
 * Non-returnability and cancellation are separate rules and must not be conflated: the backend
 * excludes blend lines from returns (`custom_blend_json IS NULL` in the return-eligibility query)
 * but applies no blend-specific cancellation rule, so an order holding a blend cancels on the
 * ordinary schedule.
 */
export function customBlendMadeToOrderNote(country: Country = 'US'): string {
  return translate(customBlendMessages, country, 'customBlend.madeToOrder');
}

/** Compatibility snapshot for legacy cart/order consumers; new UI resolves by active country. */
export const CUSTOM_BLEND_MADE_TO_ORDER_NOTE = customBlendMadeToOrderNote();

const VESSEL_MESSAGE_KEY: Readonly<Record<Vessel, keyof typeof customBlendMessages>> = {
  'kraft-sack': 'customBlend.vessel.kraftSack',
  'woven-sack': 'customBlend.vessel.wovenSack',
  keg: 'customBlend.vessel.keg',
  'food-bag': 'customBlend.vessel.foodBag',
};

/**
 * Batch marking derived from the config key. The key is already a canonical hash of the
 * specification, so equal blends mark identically and different blends mark differently without
 * the mark itself disclosing any ingredient.
 */
export function customBlendBatchMark(configKey: string): string {
  return `CB-${configKey.slice(0, 6).toUpperCase()}`;
}

/**
 * Narrow the compatibility union without guessing at any missing result facts. The API validates
 * the complete snapshot at its transport boundary; the small structural check here keeps old
 * order/cart records renderable when they only carry the historical specification.
 */
export function isResolvedCustomBlendSnapshot(
  blend: CustomBlendSnapshot | null | undefined,
): blend is ResolvedCustomBlendSnapshot {
  return (
    typeof blend === 'object' &&
    blend !== null &&
    !Array.isArray(blend) &&
    'ruleVersion' in blend &&
    blend.ruleVersion === 1 &&
    'resultClassification' in blend &&
    (blend.resultClassification === 'food' || blend.resultClassification === 'non-food') &&
    'components' in blend &&
    Array.isArray(blend.components)
  );
}

/**
 * Human-readable composition, e.g. `Portland Cement — 30% Chalk Filler, 10% Silica Flour`.
 * Ingredient order follows the snapshot, which the server already canonicalises.
 */
export function customBlendCompositionLabel(
  baseProductName: string,
  blend: CustomBlendSnapshot,
  country: Country = 'US',
): string {
  const ingredients = blend.ingredients
    .map((ingredient) =>
      translate(customBlendMessages, country, 'customBlend.recipeIngredient', {
        percentageLabel: formatNumber(ingredient.percentage, country, 'count'),
        name: ingredient.productName,
      }),
    )
    .join(', ');
  return translate(customBlendMessages, country, 'customBlend.recipe', {
    basePercentageLabel: formatNumber(blend.basePercentage, country, 'count'),
    baseName: baseProductName,
    ingredients,
  });
}

interface CustomBlendPackagingProps {
  product: PackagingProductInput;
  variant?: Pick<CatalogVariant, 'sku' | 'label'>;
  blend: CustomBlendSnapshot;
  /** Draft previews have no server config key; their mark must never claim one. */
  previewBatchMark?: string;
  className?: string;
}

/**
 * Custom Blend livery. The base product's category alone selects the vessel shape (via the shared
 * resolver), then the decoration is replaced wholesale by the fixed charcoal scheme, the spec band
 * and the config-key batch mark. Safety ink (`alert`) stays category-owned, so a hazard treatment
 * is never softened by the blend livery.
 *
 * Unlike `ProductMedia`, no catalog palette gate applies: the livery is not a catalog scheme, so a
 * base product without a resolved palette still prints its vessel rather than the generic
 * placeholder.
 */
export function CustomBlendPackaging({
  product,
  variant,
  blend,
  previewBatchMark,
  className,
}: CustomBlendPackagingProps) {
  const { translate: t } = useLocalisation();
  const specBand = t(customBlendMessages, 'customBlend.specBand');
  const vesselLabel = (vessel: Vessel) => t(customBlendMessages, VESSEL_MESSAGE_KEY[vessel]);
  const resolvedBlend = isResolvedCustomBlendSnapshot(blend) ? blend : undefined;
  const resultLabel = resolvedBlend
    ? t(
        customBlendMessages,
        resolvedBlend.resultClassification === 'food'
          ? 'customBlend.resultFood'
          : 'customBlend.resultNonFood',
      )
    : undefined;
  const safetyLabel =
    resolvedBlend?.resultClassification === 'non-food'
      ? t(customBlendMessages, 'customBlend.notForConsumption')
      : undefined;
  const safetyWarning =
    resolvedBlend?.resultClassification === 'non-food'
      ? t(customBlendMessages, 'customBlend.safetyWarning')
      : undefined;
  // Orders written before base presentation was frozen cannot safely infer a vessel. In
  // particular, the shared resolver's unknown-category fallback is a food bag, which would make
  // an historic non-food blend misleading. Show a neutral, explicit placeholder instead.
  if (!product.category) {
    return (
      <span
        role="img"
        aria-label={`${product.name} ${t(customBlendMessages, 'customBlend.neutralPackaging')} ${t(customBlendMessages, 'customBlend.packagingUnavailableAria')}`}
        className={className}
        data-testid="custom-blend-livery"
        data-vessel="neutral"
        data-colour-scheme="neutral"
      >
        {t(customBlendMessages, 'customBlend.neutralPackaging')}
      </span>
    );
  }
  // The blend result, rather than the base row, owns the consumption treatment. Keep all other
  // category facts intact so the heavy-duty renderer retains its category-owned hazard ink/text.
  const baseSpec = resolvePackagingSpec({
    product: resolvedBlend
      ? { ...product, consumptionClassification: resolvedBlend.resultClassification }
      : product,
    variant,
  });
  const mark = previewBatchMark ?? customBlendBatchMark(blend.configKey);
  const spec = {
    ...baseSpec,
    schemeKey: CUSTOM_BLEND_SCHEME_KEY,
    pigment: CUSTOM_BLEND_PIGMENT,
    ink: { ink: CUSTOM_BLEND_INK, alert: baseSpec.ink.alert },
    grade: baseSpec.grade ?? specBand,
    lot: mark,
    // Heavy-duty vessels do not consume PackagingArtwork's food-bag-only label slot. Include the
    // resolved safety label in their existing hazard line as well, preserving explicit localised
    // treatment for a contaminated blend without changing the vessel geometry.
    ...(safetyLabel
      ? {
          hazard: [baseSpec.hazard, safetyLabel].filter(Boolean).join(' · '),
        }
      : {}),
  };

  return (
    // `display: contents` keeps the diagnostic attributes queryable without adding a box that
    // would change how the vessel sizes inside its existing containers.
    <span
      className="contents"
      data-testid="custom-blend-livery"
      data-vessel={spec.vessel}
      data-colour-scheme={CUSTOM_BLEND_SCHEME_KEY}
      // Read from the resolved spec, not the constants, so any composition-derived colour would be
      // observable here instead of hiding behind a literal that cannot vary.
      data-pigment={spec.pigment}
      data-ink={spec.ink.ink}
      data-batch-mark={mark}
      {...(resolvedBlend
        ? { 'data-result-classification': resolvedBlend.resultClassification }
        : {})}
    >
      <PackagingArtwork
        name={product.name}
        spec={spec}
        mark="CB"
        // The food-bag renderer has no grade slot; its printed quantity line is the equivalent
        // short label. Pass the resolved grade through so its `CUSTOM BLEND` fallback is visible.
        quantity={spec.grade}
        batchCode={mark}
        schemeKey={CUSTOM_BLEND_SCHEME_KEY}
        consumptionLabel={safetyLabel ?? resultLabel ?? null}
        ariaLabel={`${product.name} ${resultLabel ?? t(customBlendMessages, 'customBlend.neutralPackaging')} ${safetyLabel ? `${safetyLabel} ` : ''}${vesselLabel(spec.vessel)}`}
        className={className}
      />
      {resolvedBlend && (
        <span className="sr-only" data-testid="custom-blend-result">
          {resultLabel}
          {safetyLabel && (
            <>
              {' '}
              {safetyLabel} {safetyWarning}
            </>
          )}
        </span>
      )}
    </span>
  );
}
