import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { CartLine } from '@shop/contracts/cart';
import type { CustomBlendOption, CustomBlendOptionsResponse } from '@shop/contracts/custom-blends';
import type { PublicErrorCode } from '@shop/contracts/public-errors';
import type { MessageParams } from '@shop/localisation';
import type { PreviewIngredient } from './CustomBlendPreview';

import { getCustomBlendOptions } from '@/api/customBlends';
import { ApiError, type ApiErrorMeta } from '@/api/client';
import { Button } from '@/components/ui/button';
import { useCartContext } from '@/hooks/CartContext';
import { useLocalisation } from '@/i18n/LocaleContext';
import { apiErrors } from '@shop/localisation/messages/apiErrors';
import { customBlendMessages } from '@shop/localisation/messages/customBlend';
import type { CustomBlendMessageKey } from '@shop/localisation/messages/customBlend';
import { BasePicker, SelectedBaseChip } from './BasePicker';
import { BlendSummaryAside } from './BlendSummaryAside';
import { IngredientPicker } from './IngredientPicker';
import { RatioEditor } from './RatioEditor';
import { SuccessRecap } from './SuccessRecap';
import { useCustomBlendEvaluation } from './useCustomBlendEvaluation';
import {
  MAX_INGREDIENTS,
  MAX_INGREDIENT_PERCENTAGE,
  MIN_INGREDIENT_PERCENTAGE,
  customBlendReducer,
  customBlendValidation,
  derivedBasePercentage,
  initialCustomBlendState,
  ingredientTotalPercentage,
  balanceEvenlyPercentages,
  isIngredientLimitReached,
  snapshotToDraftIngredients,
  toIngredientInputs,
} from './customBlendState';

function parsePositiveInteger(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Stable options failure identity; copy is resolved during render for the active country. */
type OptionsErrorState = {
  readonly code: PublicErrorCode | null;
  readonly meta: ApiErrorMeta | null;
  readonly fallbackKey: CustomBlendMessageKey;
};

function safeErrorParams(meta: ApiErrorMeta | null): MessageParams {
  if (!meta || typeof meta !== 'object') return {};
  const params: Record<string, string | number | bigint> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint')
      params[key] = value;
  }
  return params;
}

function optionsErrorState(error: unknown): OptionsErrorState {
  if (error instanceof ApiError && error.code !== null) {
    return {
      code: error.code,
      meta: error.meta,
      fallbackKey: 'customBlend.invalidBase',
    };
  }
  // API prose, network messages, contract failures, and unknown exceptions are deliberately
  // discarded. The fallback key is rendered against the current country on every render.
  return { code: null, meta: null, fallbackKey: 'customBlend.invalidBase' };
}

export function CustomBlendPage() {
  const { activeCountry, translate, formatCount } = useLocalisation();
  const [searchParams, setSearchParams] = useSearchParams();
  const baseVariantParam = searchParams.get('baseVariantId');
  const editConfigKey = searchParams.get('editConfigKey');
  const baseVariantId = parsePositiveInteger(baseVariantParam);
  const hasUnparseableBaseParam = baseVariantParam !== null && baseVariantId === null;
  const {
    cart,
    error: cartError,
    isCartAvailable,
    addCustomBlend,
    replaceCustomBlend,
    retryCart,
  } = useCartContext();
  const [state, dispatch] = useReducer(customBlendReducer, initialCustomBlendState);
  const [options, setOptions] = useState<CustomBlendOptionsResponse | null>(null);
  const [optionsError, setOptionsError] = useState<OptionsErrorState | null>(null);
  const [isOptionsLoading, setIsOptionsLoading] = useState(false);
  const [lineError, setLineError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    kind: 'created' | 'replaced';
    base: CustomBlendOption;
    basePercentage: number;
    ingredients: PreviewIngredient[];
    authoritativeConfigKey?: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const optionsRequestIdRef = useRef(0);
  const hydratedTargetRef = useRef<string | null>(null);
  const activeTargetRef = useRef<string | null>(null);

  // The URL owns the configurator target. Every change to it is pushed into the draft so no
  // part of the draft — base lot, edit config key, locked quantity — can outlive the URL that
  // produced it. Leaving edit mode is therefore a URL edit, not a separate reducer path.
  const targetKey = `${baseVariantId ?? ''}:${editConfigKey ?? ''}`;
  useEffect(() => {
    if (activeTargetRef.current === targetKey) return;
    activeTargetRef.current = targetKey;
    // A new target must be re-hydrated from the cart, including a return to a target that was
    // hydrated earlier in this mount.
    hydratedTargetRef.current = null;
    setLineError(null);
    dispatch({ type: 'target-changed', baseVariantId, editConfigKey });
  }, [baseVariantId, editConfigKey, targetKey]);

  // Each base or country change starts a new options query. A superseded response is dropped
  // rather than allowed to repopulate the picker behind the customer's current choice.
  useEffect(() => {
    if (baseVariantId === null) {
      setOptions(null);
      setOptionsError(null);
      setIsOptionsLoading(false);
      return;
    }
    const requestId = ++optionsRequestIdRef.current;
    const controller = new AbortController();
    const isCurrent = () => requestId === optionsRequestIdRef.current;
    setOptions(null);
    setOptionsError(null);
    setIsOptionsLoading(true);
    void (async () => {
      try {
        const data = await getCustomBlendOptions(baseVariantId, controller.signal);
        if (!isCurrent()) return;
        setOptions(data);
      } catch (error) {
        if (!isCurrent()) return;
        setOptionsError(optionsErrorState(error));
      } finally {
        if (isCurrent()) setIsOptionsLoading(false);
      }
    })();
    return () => {
      ++optionsRequestIdRef.current;
      controller.abort();
    };
  }, [activeCountry, baseVariantId]);

  const editLine: CartLine | null = useMemo(() => {
    if (!editConfigKey || baseVariantId === null || !cart) return null;
    return (
      cart.items.find(
        (item) => item.configKey === editConfigKey && item.variantSnap?.variantId === baseVariantId,
      ) ?? null
    );
  }, [baseVariantId, cart, editConfigKey]);

  // Hydrate the draft once per edit target: a later cart refresh must not discard
  // in-progress edits, and a completed replace must not re-read its own stale key.
  useEffect(() => {
    if (!editConfigKey || baseVariantId === null || result !== null) return;
    const target = `${baseVariantId}:${editConfigKey}`;
    if (hydratedTargetRef.current === target) return;
    if (!cart) return;
    if (!editLine?.customBlend) {
      setLineError(translate(customBlendMessages, 'customBlend.missingLine'));
      return;
    }
    hydratedTargetRef.current = target;
    setLineError(null);
    dispatch({
      type: 'edit-loaded',
      baseVariantId,
      configKey: editConfigKey,
      quantity: editLine.quantity,
      ingredients: snapshotToDraftIngredients(editLine.customBlend),
    });
  }, [baseVariantId, cart, editConfigKey, editLine, result]);

  const validation = customBlendValidation(state);
  const basePercentage = derivedBasePercentage(state);
  const totalPercentage = ingredientTotalPercentage(state);
  const isEditing = state.editConfigKey !== null;
  const renderedOptionsError =
    optionsError === null
      ? null
      : optionsError.code !== null
        ? (() => {
            try {
              return translate(apiErrors, optionsError.code, safeErrorParams(optionsError.meta));
            } catch {
              return translate(customBlendMessages, optionsError.fallbackKey);
            }
          })()
        : translate(customBlendMessages, optionsError.fallbackKey);
  const selectBase = (variantId: number) => {
    const next = new URLSearchParams(searchParams);
    next.set('baseVariantId', String(variantId));
    next.delete('editConfigKey');
    setSearchParams(next);
  };
  const clearBase = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('baseVariantId');
    next.delete('editConfigKey');
    setSearchParams(next);
  };

  // Defence in depth: a draft that does not match the target currently named by the URL must
  // never reach the cart, because a replace keyed on a stale config key would overwrite a
  // different line than the one on screen. The stricter equality also prevents an edit draft from
  // being evaluated before its cart line has hydrated.
  const isDraftOnCurrentTarget =
    state.baseVariantId === baseVariantId &&
    (editConfigKey === null ? state.editConfigKey === null : state.editConfigKey === editConfigKey);
  const evaluation = useCustomBlendEvaluation({
    baseVariantId: isDraftOnCurrentTarget ? state.baseVariantId : null,
    ingredients: state.ingredients,
    quantity: isDraftOnCurrentTarget ? state.lockedQuantity : null,
    editConfigKey: isDraftOnCurrentTarget ? state.editConfigKey : null,
  });
  const evaluatedSnapshot = evaluation.result?.customBlend ?? null;
  const hasExactEvaluation =
    isDraftOnCurrentTarget &&
    evaluation.isStructurallyValid &&
    !evaluation.loading &&
    evaluation.error === null &&
    evaluation.result !== null &&
    evaluatedSnapshot !== null &&
    evaluation.quantity !== null &&
    evaluatedSnapshot.quantity === evaluation.quantity &&
    (state.lockedQuantity === null || evaluation.quantity === state.lockedQuantity) &&
    evaluatedSnapshot.basePercentage === basePercentage &&
    evaluatedSnapshot.components.some(
      (component) => component.role === 'base' && component.variantId === state.baseVariantId,
    ) &&
    evaluatedSnapshot.ingredients.length === state.ingredients.length &&
    state.ingredients.every((ingredient) =>
      evaluatedSnapshot.ingredients.some(
        (resolvedIngredient) =>
          resolvedIngredient.variantId === ingredient.variantId &&
          resolvedIngredient.percentage === ingredient.percentage,
      ),
    );
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      !validation.isValid ||
      !hasExactEvaluation ||
      state.baseVariantId === null ||
      evaluation.result === null ||
      evaluation.quantity === null ||
      isSubmitting
    )
      return;
    setIsSubmitting(true);
    try {
      const ingredients = toIngredientInputs(state);
      const completedCart =
        state.editConfigKey === null
          ? await addCustomBlend({
              baseVariantId: state.baseVariantId,
              ingredients,
              quantity: evaluation.quantity,
            })
          : await replaceCustomBlend({
              baseVariantId: state.baseVariantId,
              configKey: state.editConfigKey,
              ingredients,
            });
      if (completedCart && options) {
        // The mutation response is authoritative for the cart line key. The evaluation key is a
        // safe fallback for test doubles/legacy adapters that omit the returned line, but a stale
        // edit target is never presented as the new batch mark.
        const authoritativeConfigKey =
          completedCart.items.find(
            (item) =>
              item.configKey === evaluation.result?.customBlend.configKey &&
              item.variantSnap?.variantId === state.baseVariantId,
          )?.configKey ?? evaluation.result.customBlend.configKey;
        const resolvedIngredients = evaluation.result.customBlend.ingredients
          .map((ingredient) => {
            const option = options.ingredients.find(
              (candidate) => candidate.variant.variantId === ingredient.variantId,
            );
            return option ? { option, percentage: ingredient.percentage } : null;
          })
          .filter((ingredient): ingredient is PreviewIngredient => ingredient !== null);
        setResult({
          kind: state.editConfigKey === null ? 'created' : 'replaced',
          base: options.base,
          basePercentage: evaluation.result.customBlend.basePercentage,
          ingredients: resolvedIngredients,
          authoritativeConfigKey,
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const percentages = new Map(
    state.ingredients.map((ingredient) => [ingredient.variantId, ingredient.percentage]),
  );
  if (result !== null) {
    return (
      <SuccessRecap
        result={result.kind}
        base={result.base}
        basePercentage={result.basePercentage}
        ingredients={result.ingredients}
        authoritativeConfigKey={result.authoritativeConfigKey}
      />
    );
  }
  return (
    <div className="pb-12">
      <header className="mb-7 max-w-3xl">
        <p className="custom-blend-eyebrow-rule section-eyebrow">
          {translate(customBlendMessages, 'customBlend.name')}
        </p>
        <h1 className="section-heading mt-2">
          {translate(
            customBlendMessages,
            isEditing ? 'customBlend.title.edit' : 'customBlend.title.new',
          )}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {translate(customBlendMessages, 'customBlend.description', {
            maxIngredients: MAX_INGREDIENTS,
            minPercentage: MIN_INGREDIENT_PERCENTAGE,
            maxPercentage: MAX_INGREDIENT_PERCENTAGE,
          })}
        </p>
      </header>
      {(hasUnparseableBaseParam || optionsError) && (
        <div role="alert" className="mb-6 rounded-xl border border-destructive/40 px-4 py-3">
          <p className="text-sm text-destructive">
            {hasUnparseableBaseParam
              ? translate(customBlendMessages, 'customBlend.invalidBase')
              : renderedOptionsError}
          </p>
          <Button className="mt-3" variant="outline" size="sm" onClick={clearBase}>
            {translate(customBlendMessages, 'customBlend.chooseAnotherBase')}
          </Button>
        </div>
      )}
      {lineError && (
        <div role="alert" className="mb-6 rounded-xl border border-destructive/40 px-4 py-3">
          <p className="text-sm text-destructive">{lineError}</p>
          <Button className="mt-3" variant="outline" size="sm" onClick={clearBase}>
            {translate(customBlendMessages, 'customBlend.startNewBlend')}
          </Button>
        </div>
      )}
      {cartError && (
        <div
          role="alert"
          className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-destructive/40 px-4 py-3"
        >
          <p className="text-sm text-destructive">{cartError}</p>
          <Button variant="outline" size="sm" onClick={() => void retryCart()}>
            {translate(customBlendMessages, 'customBlend.retryCart')}
          </Button>
        </div>
      )}
      {baseVariantId === null || optionsError ? (
        <BasePicker onSelectBase={selectBase} suppressError={hasUnparseableBaseParam} />
      ) : isOptionsLoading || !options ? (
        <div
          aria-live="polite"
          aria-label={translate(customBlendMessages, 'customBlend.loadingOptions')}
          className="grid gap-3"
        >
          <div className="h-32 animate-pulse rounded-xl bg-muted" />
          <div className="h-32 animate-pulse rounded-xl bg-muted" />
        </div>
      ) : (
        <form
          onSubmit={(event) => void handleSubmit(event)}
          className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]"
        >
          <div className="grid gap-8">
            <section
              aria-labelledby="custom-blend-base-heading"
              className="custom-blend-surface rounded-xl p-5"
            >
              <p className="text-sm font-medium text-muted-foreground">
                {translate(customBlendMessages, 'customBlend.baseStep')}
              </p>
              <h2 id="custom-blend-base-heading" className="text-xl font-semibold">
                {translate(customBlendMessages, 'customBlend.baseMaterial')}
              </h2>
              {!isEditing && <SelectedBaseChip base={options.base} onChange={clearBase} />}
              {state.lockedQuantity !== null && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {translate(customBlendMessages, 'customBlend.quantity', {
                    count: state.lockedQuantity,
                    countLabel: formatCount(state.lockedQuantity),
                  })}
                </p>
              )}
            </section>
            <IngredientPicker
              options={options.ingredients.filter(
                (option) => option.variant.variantId !== state.baseVariantId,
              )}
              selectedVariantIds={state.ingredients.map((ingredient) => ingredient.variantId)}
              isLimitReached={isIngredientLimitReached(state)}
              onToggle={(variantId) => dispatch({ type: 'ingredient-toggled', variantId })}
            />
            <RatioEditor
              options={options.ingredients.filter(
                (option) => option.variant.variantId !== state.baseVariantId,
              )}
              selectedVariantIds={state.ingredients.map((ingredient) => ingredient.variantId)}
              percentages={percentages}
              onPercentageChange={(variantId, percentage) =>
                dispatch({ type: 'percentage-changed', variantId, percentage })
              }
              onBalanceEvenly={() => {
                const balanced = balanceEvenlyPercentages(
                  state.ingredients.map((ingredient) => ingredient.variantId),
                );
                state.ingredients.forEach((ingredient) =>
                  dispatch({
                    type: 'percentage-changed',
                    variantId: ingredient.variantId,
                    percentage: balanced.get(ingredient.variantId) ?? ingredient.percentage,
                  }),
                );
              }}
            />
          </div>
          <BlendSummaryAside
            base={options.base}
            basePercentage={basePercentage}
            totalPercentage={totalPercentage}
            ingredientCount={state.ingredients.length}
            errors={validation.errors}
            isEditing={isEditing}
            isValid={validation.isValid}
            isCartAvailable={isCartAvailable}
            isSubmitting={isSubmitting}
            mixBase={{
              productId: options.base.productId,
              productName: options.base.productName,
              category: options.base.category,
              percentage: basePercentage,
            }}
            mixIngredients={options.ingredients
              .filter((option) => percentages.has(option.variant.variantId))
              .map((option) => ({
                productId: option.productId,
                productName: option.productName,
                category: option.category,
                percentage: percentages.get(option.variant.variantId) ?? 0,
              }))}
            previewIngredients={options.ingredients
              .filter(
                (option) =>
                  option.variant.variantId !== state.baseVariantId &&
                  percentages.has(option.variant.variantId),
              )
              .map((option) => ({
                option,
                percentage: percentages.get(option.variant.variantId) ?? 0,
              }))}
            configKey={state.editConfigKey ?? undefined}
            evaluation={evaluation.result}
            evaluationLoading={
              evaluation.loading || (!isDraftOnCurrentTarget && lineError === null)
            }
            evaluationError={evaluation.error}
            onRetryEvaluation={evaluation.retry}
          />
        </form>
      )}
    </div>
  );
}
