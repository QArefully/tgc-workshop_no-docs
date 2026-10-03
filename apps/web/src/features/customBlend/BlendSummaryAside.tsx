import type {
  CustomBlendEvaluationResponse,
  CustomBlendOption,
  ResolvedCustomBlendSnapshot,
} from '@shop/contracts/custom-blends';
import type { PublicErrorCode } from '@shop/contracts/public-errors';

import type { ApiErrorMeta } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useLocalisation } from '@/i18n/LocaleContext';
import { apiErrors } from '@shop/localisation/messages/apiErrors';
import { commonMessages } from '@shop/localisation/messages/common';
import { customBlendMessages } from '@shop/localisation/messages/customBlend';
import { CustomBlendPreview, type PreviewIngredient } from './CustomBlendPreview';
import { MixVisualization } from './MixVisualization';
import type { MixPart } from './MixVisualization';
import { RatioGauge } from './RatioGauge';
import type { CustomBlendMessage } from './customBlendState';

export type CustomBlendEvaluationErrorView = {
  readonly code: PublicErrorCode | null;
  readonly meta: ApiErrorMeta | null;
};

function errorParams(meta: ApiErrorMeta | null): Record<string, string | number | bigint> {
  if (!meta) return {};
  return Object.fromEntries(
    Object.entries(meta).filter(
      ([, value]) =>
        typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint',
    ),
  ) as Record<string, string | number | bigint>;
}

function evaluationErrorMessage(
  error: CustomBlendEvaluationErrorView,
  translate: ReturnType<typeof useLocalisation>['translate'],
): string {
  if (error.code !== null) {
    try {
      return translate(apiErrors, error.code, errorParams(error.meta));
    } catch {
      // Unknown/stale public codes use the safe feature fallback below.
    }
  }
  return translate(customBlendMessages, 'customBlend.evaluationFailed');
}

function roleLabel(
  role: 'base' | 'ingredient',
  translate: ReturnType<typeof useLocalisation>['translate'],
): string {
  return translate(
    customBlendMessages,
    role === 'base' ? 'customBlend.componentBase' : 'customBlend.componentIngredient',
  );
}

/**
 * Renders the authoritative server verdict alongside the draft controls. Price, quantity,
 * classification, and component totals are read from the resolved snapshot; this component never
 * derives a replacement price from catalog options.
 */
export function BlendSummaryAside({
  base,
  basePercentage,
  totalPercentage,
  ingredientCount,
  errors,
  isEditing,
  isValid,
  isCartAvailable,
  isSubmitting,
  mixBase,
  mixIngredients,
  previewIngredients,
  configKey,
  evaluation,
  resolved,
  evaluationLoading = false,
  evaluationError = null,
  onRetryEvaluation,
}: {
  base: CustomBlendOption;
  basePercentage: number;
  totalPercentage: number;
  ingredientCount: number;
  errors: readonly CustomBlendMessage[];
  isEditing: boolean;
  isValid: boolean;
  isCartAvailable: boolean;
  isSubmitting: boolean;
  mixBase: MixPart;
  mixIngredients: readonly MixPart[];
  previewIngredients: readonly PreviewIngredient[];
  configKey?: string;
  /** Full response from `useCustomBlendEvaluation`, if one has completed successfully. */
  evaluation?: CustomBlendEvaluationResponse | null;
  /** Direct snapshot alias for consumers that already split the response. */
  resolved?: ResolvedCustomBlendSnapshot | null;
  evaluationLoading?: boolean;
  evaluationError?: CustomBlendEvaluationErrorView | null;
  onRetryEvaluation?: () => void;
}) {
  const { translate, formatNumber, formatMoney, formatWeightGrams } = useLocalisation();
  const resolvedSnapshot = resolved ?? evaluation?.customBlend ?? null;
  const renderValidationError = (error: CustomBlendMessage) => {
    const params = { ...(error.params ?? {}) } as Record<string, string | number | bigint>;
    for (const [name, value] of Object.entries(error.params ?? {})) {
      if (typeof value === 'number') params[`${name}Label`] = formatNumber(value);
    }
    return translate(customBlendMessages, error.key, params);
  };

  const renderServerComponents = (snapshot: ResolvedCustomBlendSnapshot) => (
    <section
      aria-labelledby="custom-blend-components-heading"
      className="custom-blend-surface grid gap-2 rounded-xl p-4"
    >
      <h2 id="custom-blend-components-heading" className="text-base font-semibold">
        {translate(customBlendMessages, 'customBlend.blendRecap')}
      </h2>
      <ul className="grid gap-2 text-sm">
        {snapshot.components.map((component) => (
          <li key={`${component.role}:${component.variantId}`} className="grid gap-0.5">
            <span className="font-medium">
              {component.productName} · {formatNumber(component.percentage, 'count')}%
            </span>
            <span className="text-xs text-muted-foreground">
              {translate(customBlendMessages, 'customBlend.componentRole', {
                role: roleLabel(component.role, translate),
              })}
            </span>
            <span className="text-xs text-muted-foreground">
              {translate(customBlendMessages, 'customBlend.componentWeight', {
                weight: formatWeightGrams(component.weightGrams),
              })}
            </span>
            <span className="text-xs text-muted-foreground">
              {translate(customBlendMessages, 'customBlend.componentSourcePrice', {
                money: formatMoney(component.sourceUnitPriceCents),
              })}
            </span>
            {component.clearance && (
              <span className="text-xs text-muted-foreground">
                {translate(customBlendMessages, 'customBlend.componentClearance', {
                  money: formatMoney(component.clearance.priceCents),
                })}
              </span>
            )}
            {component.tierDiscountPct > 0 && (
              <span className="text-xs text-muted-foreground">
                {translate(customBlendMessages, 'customBlend.componentTier', {
                  discountPct: formatNumber(component.tierDiscountPct, 'count'),
                })}
              </span>
            )}
            {component.nextTierProgress && (
              <span className="text-xs text-muted-foreground">
                {translate(customBlendMessages, 'customBlend.componentNextTier', {
                  sacksToNextTier: formatNumber(
                    component.nextTierProgress.sacksToNextTier,
                    'count',
                  ),
                  minTonnes: formatNumber(component.nextTierProgress.minTonnes, 'count'),
                  discountPct: formatNumber(component.nextTierProgress.discountPct, 'count'),
                })}
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {translate(customBlendMessages, 'customBlend.componentUnitContribution', {
                money: formatMoney(component.unitContributionCents),
              })}
            </span>
            <span className="text-xs text-muted-foreground">
              {translate(customBlendMessages, 'customBlend.componentSubtotal', {
                money: formatMoney(component.subtotalCents),
              })}
            </span>
          </li>
        ))}
      </ul>
      <div className="grid gap-1 border-t pt-2 text-sm">
        <p>
          {translate(customBlendMessages, 'customBlend.materialUnitPrice', {
            money: formatMoney(snapshot.materialUnitPriceCents),
          })}
        </p>
        <p>
          {translate(customBlendMessages, 'customBlend.materialSubtotal', {
            money: formatMoney(snapshot.materialSubtotalCents),
          })}
        </p>
        <p>
          {translate(customBlendMessages, 'customBlend.blendingFee', {
            money: formatMoney(snapshot.blendingFeeCents),
          })}
        </p>
        <p className="font-semibold">
          {translate(customBlendMessages, 'customBlend.lineTotal', {
            money: formatMoney(snapshot.lineTotalCents),
          })}
        </p>
      </div>
    </section>
  );

  const baseComponent = resolvedSnapshot?.components.find((component) => component.role === 'base');
  const serverMixBase: MixPart = resolvedSnapshot
    ? {
        productId: baseComponent?.productId ?? mixBase.productId,
        productName: baseComponent?.productName ?? mixBase.productName,
        category: mixBase.category,
        percentage: baseComponent?.percentage ?? mixBase.percentage,
      }
    : mixBase;
  const serverMixIngredients: readonly MixPart[] = resolvedSnapshot
    ? resolvedSnapshot.components
        .filter((component) => component.role === 'ingredient')
        .map((component) => ({
          productId: component.productId,
          productName: component.productName,
          category:
            mixIngredients.find((part) => part.productId === component.productId)?.category ??
            base.category,
          percentage: component.percentage,
        }))
    : mixIngredients;
  const submitDisabled =
    !isValid || !isCartAvailable || isSubmitting || evaluationLoading || resolvedSnapshot === null;

  return (
    <aside className="lg:sticky lg:top-6 lg:self-start">
      <Card className="custom-blend-surface">
        <CardHeader>
          <p className="text-sm font-medium text-muted-foreground">
            {translate(customBlendMessages, 'customBlend.reviewStep')}
          </p>
          <CardTitle>{translate(customBlendMessages, 'customBlend.reviewTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <CustomBlendPreview
            base={base}
            basePercentage={basePercentage}
            ingredients={previewIngredients}
            configKey={configKey}
            resolved={resolvedSnapshot}
          />
          <Separator />
          <RatioGauge
            basePercentage={resolvedSnapshot?.basePercentage ?? basePercentage}
            totalPercentage={totalPercentage}
            ingredientCount={resolvedSnapshot?.ingredients.length ?? ingredientCount}
            isValid={isValid && resolvedSnapshot !== null}
          />
          <MixVisualization base={serverMixBase} ingredients={serverMixIngredients} />
          {resolvedSnapshot && (
            <section
              aria-label={translate(
                customBlendMessages,
                resolvedSnapshot.resultClassification === 'food'
                  ? 'customBlend.resultFood'
                  : 'customBlend.resultNonFood',
              )}
            >
              <p
                className="text-sm font-semibold"
                data-result-classification={resolvedSnapshot.resultClassification}
              >
                {translate(
                  customBlendMessages,
                  resolvedSnapshot.resultClassification === 'food'
                    ? 'customBlend.resultFood'
                    : 'customBlend.resultNonFood',
                )}
              </p>
              {resolvedSnapshot.resultClassification === 'non-food' && (
                <p className="text-xs text-destructive">
                  {translate(customBlendMessages, 'customBlend.notForConsumption')}
                </p>
              )}
            </section>
          )}
          {resolvedSnapshot && renderServerComponents(resolvedSnapshot)}
          {evaluationLoading && (
            <p role="status" aria-live="polite" aria-busy="true">
              {translate(customBlendMessages, 'customBlend.evaluationLoading')}
            </p>
          )}
          {evaluationError && !evaluationLoading && (
            <div role="alert" aria-live="assertive" className="grid gap-2">
              <p className="text-sm text-destructive">
                {evaluationErrorMessage(evaluationError, translate)}
              </p>
              {onRetryEvaluation && (
                <Button type="button" variant="outline" size="sm" onClick={onRetryEvaluation}>
                  {translate(commonMessages, 'common.retry')}
                </Button>
              )}
            </div>
          )}
          {errors.length > 0 && (
            <ul className="grid gap-1" role="alert">
              {errors.map((error) => (
                <li
                  key={`${error.key}:${JSON.stringify(error.params ?? {})}`}
                  className="text-sm text-destructive"
                >
                  {renderValidationError(error)}
                </li>
              ))}
            </ul>
          )}
          <Button type="submit" disabled={submitDisabled}>
            {translate(
              customBlendMessages,
              isEditing ? 'customBlend.update' : 'customBlend.addToCart',
            )}
          </Button>
        </CardContent>
      </Card>
    </aside>
  );
}
