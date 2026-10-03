import { useCallback, useEffect, useRef, useState } from 'react';
import type { Country } from '@shop/contracts/country';
import type {
  CustomBlendEvaluationBody,
  CustomBlendEvaluationResponse,
  CustomBlendIngredientInput,
  ResolvedCustomBlendSnapshot,
} from '@shop/contracts/custom-blends';
import type { PublicErrorCode } from '@shop/contracts/public-errors';
import { evaluateCustomBlend } from '@/api/customBlends';
import { ApiError, type ApiErrorMeta } from '@/api/client';
import { useOptionalCountry } from '@/hooks/CountryContext';
import {
  customBlendValidation,
  type CustomBlendDraftIngredient,
  type CustomBlendState,
} from './customBlendState';

const EVALUATION_DEBOUNCE_MS = 150;

/** Stable, render-safe identity of a failed evaluation. API prose is intentionally not retained. */
export interface CustomBlendEvaluationError {
  readonly code: PublicErrorCode | null;
  readonly meta: ApiErrorMeta | null;
}

export interface CustomBlendEvaluationOptions {
  /** Current selected base lot. `null` means that the draft cannot be evaluated. */
  readonly baseVariantId?: number | null;
  /** Draft ingredient rows. They are copied before being sent or used in a request key. */
  readonly ingredients?: readonly (CustomBlendDraftIngredient | CustomBlendIngredientInput)[];
  /** `null`/`undefined` omits quantity so the API can apply the base MOQ. */
  readonly quantity?: number | null;
  /** Cart-line target being edited, or `null` for a new blend. */
  readonly editConfigKey?: string | null;
  /** Convenience input for callers that already hold the configurator reducer state. */
  readonly draft?: Pick<
    CustomBlendState,
    'baseVariantId' | 'ingredients' | 'lockedQuantity' | 'editConfigKey'
  >;
  /** Alias accepted for callers that name the reducer value `state`. */
  readonly state?: Pick<
    CustomBlendState,
    'baseVariantId' | 'ingredients' | 'lockedQuantity' | 'editConfigKey'
  >;
}

export interface CustomBlendEvaluationResult {
  /** Full server response; `null` until the exact current draft has succeeded. */
  readonly result: CustomBlendEvaluationResponse | null;
  /** Alias for consumers that call the response an evaluation. */
  readonly evaluation: CustomBlendEvaluationResponse | null;
  readonly resolved: CustomBlendEvaluationResponse | null;
  /** Quantity resolved by the server for the exact active request. */
  readonly quantity: number | null;
  readonly resolvedQuantity: number | null;
  /** Resolved server snapshot for the exact active request. */
  readonly snapshot: ResolvedCustomBlendSnapshot | null;
  readonly resolvedSnapshot: ResolvedCustomBlendSnapshot | null;
  /** True during the debounce window and while the request is in flight. */
  readonly loading: boolean;
  readonly isLoading: boolean;
  /** Stable coded error; server exception prose is never exposed. */
  readonly error: CustomBlendEvaluationError | null;
  readonly errorState: CustomBlendEvaluationError | null;
  /** Structural validity is local input gating only; compatibility and pricing stay server-owned. */
  readonly isStructurallyValid: boolean;
  /** Re-evaluates the same draft after a failure (or when a caller explicitly wants a refresh). */
  readonly retry: () => void;
  readonly retryEvaluation: () => void;
}

type DraftValues = {
  baseVariantId: number | null;
  ingredients: readonly (CustomBlendDraftIngredient | CustomBlendIngredientInput)[];
  quantity: number | null;
  editConfigKey: string | null;
};

type StoredEvaluation = {
  key: string | null;
  status: 'idle' | 'debouncing' | 'loading' | 'success' | 'error';
  response: CustomBlendEvaluationResponse | null;
  error: CustomBlendEvaluationError | null;
};

const emptyStoredEvaluation: StoredEvaluation = {
  key: null,
  status: 'idle',
  response: null,
  error: null,
};

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/**
 * The reducer validation owns the user-facing structural messages. This additional narrow check
 * only prevents malformed transport primitives from reaching the endpoint; it does not inspect
 * catalog groups, pigments, classification, tiers, or money.
 */
function isTransportSafeDraft(values: DraftValues): boolean {
  if (!positiveSafeInteger(values.baseVariantId)) return false;
  if (values.quantity !== null && !positiveSafeInteger(values.quantity)) {
    return false;
  }
  const ingredientVariantIds = new Set<number>();
  return values.ingredients.every((ingredient) => {
    if (
      !positiveSafeInteger(ingredient.variantId) ||
      Number.isSafeInteger(ingredient.percentage) === false ||
      ingredient.percentage < 0
    ) {
      return false;
    }
    if (
      ingredient.variantId === values.baseVariantId ||
      ingredientVariantIds.has(ingredient.variantId)
    ) {
      return false;
    }
    ingredientVariantIds.add(ingredient.variantId);
    return true;
  });
}

function valuesFromOptions(options: CustomBlendEvaluationOptions): DraftValues {
  const source = options.draft ?? options.state;
  return {
    baseVariantId:
      options.baseVariantId !== undefined ? options.baseVariantId : (source?.baseVariantId ?? null),
    ingredients: (options.ingredients ?? source?.ingredients ?? []).map(
      ({ variantId, percentage }) => ({ variantId, percentage }),
    ),
    quantity: options.quantity !== undefined ? options.quantity : (source?.lockedQuantity ?? null),
    editConfigKey:
      options.editConfigKey !== undefined ? options.editConfigKey : (source?.editConfigKey ?? null),
  };
}

function requestKey(country: Country, values: DraftValues): string {
  return JSON.stringify([
    country,
    values.baseVariantId,
    values.ingredients.map((ingredient) => ({
      variantId: ingredient.variantId,
      percentage: ingredient.percentage,
    })),
    values.quantity,
    values.editConfigKey,
  ]);
}

function evaluationBody(values: DraftValues): CustomBlendEvaluationBody {
  const body: CustomBlendEvaluationBody = {
    baseVariantId: values.baseVariantId!,
    ingredients: values.ingredients.map(({ variantId, percentage }) => ({
      variantId,
      percentage,
    })),
  };
  if (values.quantity !== null) body.quantity = values.quantity;
  return body;
}

function errorDescriptor(error: unknown): CustomBlendEvaluationError {
  if (error instanceof ApiError && error.code !== null) {
    return { code: error.code, meta: error.meta };
  }
  return { code: null, meta: null };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function structurallyValid(values: DraftValues): boolean {
  if (!isTransportSafeDraft(values)) return false;
  const validation = customBlendValidation({
    baseVariantId: values.baseVariantId,
    editConfigKey: values.editConfigKey,
    lockedQuantity: values.quantity,
    ingredients: values.ingredients.map(({ variantId, percentage }) => ({
      variantId,
      percentage,
    })),
  });
  return validation.isValid;
}

/**
 * Debounced, server-authoritative Custom Blend draft evaluation.
 *
 * The active request identity includes country, the complete draft, quantity, and edit target.
 * A response is published only when that identity is still current. This keeps a valid result
 * from one target from being reused for another while leaving all compatibility and pricing rules
 * to the API resolver.
 */
export function useCustomBlendEvaluation(
  options: CustomBlendEvaluationOptions,
): CustomBlendEvaluationResult {
  const { activeCountry } = useOptionalCountry();
  const values = valuesFromOptions(options);
  const key = requestKey(activeCountry, values);
  const isValid = structurallyValid(values);
  const [retryToken, setRetryToken] = useState(0);
  const [stored, setStored] = useState<StoredEvaluation>(emptyStoredEvaluation);
  const requestIdRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    controllerRef.current?.abort();
    controllerRef.current = null;

    // Publish an empty state for this key. Return values are also keyed during render below, so
    // an old verdict is hidden synchronously before this effect gets a chance to run.
    setStored({ key, status: isValid ? 'debouncing' : 'idle', response: null, error: null });
    if (!isValid) return;

    let controller: AbortController | null = null;
    const timer = window.setTimeout(() => {
      const activeController = new AbortController();
      controller = activeController;
      controllerRef.current = activeController;
      if (requestId !== requestIdRef.current || activeController.signal.aborted) return;
      setStored({ key, status: 'loading', response: null, error: null });
      void evaluateCustomBlend(evaluationBody(values), activeController.signal, activeCountry)
        .then((response) => {
          if (requestId !== requestIdRef.current || activeController.signal.aborted) return;
          setStored({ key, status: 'success', response, error: null });
        })
        .catch((error: unknown) => {
          if (
            isAbortError(error) ||
            requestId !== requestIdRef.current ||
            activeController.signal.aborted
          ) {
            return;
          }
          setStored({
            key,
            status: 'error',
            response: null,
            error: errorDescriptor(error),
          });
        })
        .finally(() => {
          if (requestId === requestIdRef.current && controllerRef.current === activeController) {
            controllerRef.current = null;
          }
        });
    }, EVALUATION_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      ++requestIdRef.current;
      controller?.abort();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
    // `key` contains every request input; retryToken deliberately re-runs the same key. `values`
    // is the render snapshot that produced that key, so it is intentionally not an object dep.
  }, [isValid, key, retryToken]);

  const retry = useCallback(() => {
    setStored({ key, status: isValid ? 'debouncing' : 'idle', response: null, error: null });
    setRetryToken((token) => token + 1);
  }, [isValid, key]);

  // During a render where the target changed, the previous state is deliberately not visible.
  // This is the synchronous invalidation guarantee; the effect above then aborts and replaces it.
  const visible = stored.key === key ? stored : emptyStoredEvaluation;
  const response = visible.status === 'success' ? visible.response : null;
  const loading = isValid && (visible.status === 'debouncing' || visible.status === 'loading');
  const error = visible.status === 'error' ? visible.error : null;
  const quantity = response?.quantity ?? null;
  const snapshot = response?.customBlend ?? null;

  return {
    result: response,
    evaluation: response,
    resolved: response,
    quantity,
    resolvedQuantity: quantity,
    snapshot,
    resolvedSnapshot: snapshot,
    loading,
    isLoading: loading,
    error,
    errorState: error,
    isStructurallyValid: isValid,
    retry,
    retryEvaluation: retry,
  };
}

export { EVALUATION_DEBOUNCE_MS as CUSTOM_BLEND_EVALUATION_DEBOUNCE_MS };
