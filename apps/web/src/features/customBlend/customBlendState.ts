import type {
  CustomBlendIngredientInput,
  CustomBlendSnapshot,
} from '@shop/contracts/custom-blends';
import {
  CUSTOM_BLEND_MAX_INGREDIENTS,
  CUSTOM_BLEND_MAX_INGREDIENT_PERCENTAGE,
  CUSTOM_BLEND_MAX_INGREDIENT_TOTAL_PERCENTAGE,
  CUSTOM_BLEND_MAX_BASE_PERCENTAGE,
  CUSTOM_BLEND_MIN_BASE_PERCENTAGE,
  CUSTOM_BLEND_MIN_INGREDIENTS,
  CUSTOM_BLEND_MIN_INGREDIENT_PERCENTAGE,
} from '@shop/contracts/custom-blends';
import type { CustomBlendMessageKey } from '@shop/localisation/messages/customBlend';

export type CustomBlendMessageParam = string | number | bigint;
export type CustomBlendMessage = {
  key: CustomBlendMessageKey;
  params?: Readonly<Record<string, CustomBlendMessageParam>>;
};

/**
 * Configurator draft state and derived blend facts.
 *
 * These rules mirror the server's `normalizeCustomBlendSpec` so the customer sees a
 * boundary before submitting. They never replace it: the backend re-validates and
 * re-resolves every fact at mutation time.
 */

// Keep the historical short exports for existing configurator callers, but source every bound
// from the shared transport contract. The web only applies these generic structural bounds; the
// server remains authoritative for compatibility, pigments, classification, and pricing.
export const MIN_INGREDIENTS = CUSTOM_BLEND_MIN_INGREDIENTS;
export const MAX_INGREDIENTS = CUSTOM_BLEND_MAX_INGREDIENTS;
export const MIN_INGREDIENT_PERCENTAGE = CUSTOM_BLEND_MIN_INGREDIENT_PERCENTAGE;
export const MAX_INGREDIENT_PERCENTAGE = CUSTOM_BLEND_MAX_INGREDIENT_PERCENTAGE;
export const MAX_INGREDIENT_TOTAL = CUSTOM_BLEND_MAX_INGREDIENT_TOTAL_PERCENTAGE;
export const MIN_BASE_PERCENTAGE = CUSTOM_BLEND_MIN_BASE_PERCENTAGE;
export const MAX_BASE_PERCENTAGE = CUSTOM_BLEND_MAX_BASE_PERCENTAGE;

export type CustomBlendDraftIngredient = {
  variantId: number;
  percentage: number;
};

export type CustomBlendState = {
  baseVariantId: number | null;
  /**
   * Config key of the cart line being edited, or `null` when configuring a new line.
   *
   * Only `edit-loaded` sets it, so a non-null value proves the draft was hydrated from that
   * exact line; `target-changed` clears it the moment the URL stops naming that target. It is
   * therefore never a stale mirror of the URL, and edit mode is derived from it rather than
   * stored as a separate lock flag.
   */
  editConfigKey: string | null;
  /** Server-owned quantity of the edited line, shown read-only. `null` when creating. */
  lockedQuantity: number | null;
  ingredients: CustomBlendDraftIngredient[];
};

export const initialCustomBlendState: CustomBlendState = {
  baseVariantId: null,
  editConfigKey: null,
  lockedQuantity: null,
  ingredients: [],
};

export type CustomBlendEvent =
  /**
   * The URL now names this configurator target. The URL owns the target, so any divergence
   * discards the draft rather than reconciling it.
   */
  | { type: 'target-changed'; baseVariantId: number | null; editConfigKey: string | null }
  | {
      type: 'edit-loaded';
      baseVariantId: number;
      configKey: string;
      quantity: number;
      ingredients: readonly CustomBlendDraftIngredient[];
    }
  | { type: 'ingredient-toggled'; variantId: number }
  | { type: 'ingredient-removed'; variantId: number }
  | { type: 'percentage-changed'; variantId: number; percentage: number };

/**
 * Percentages for the draft after adding `variantId`.
 *
 * Two paths, because the first pick alone consumes the whole 50% budget:
 * - budget left at or above the 5% floor -> the new ingredient takes it (capped at 50%) and every
 *   existing ingredient keeps its percentage, so manual tuning survives a later pick.
 * - budget exhausted -> rebalance existing and new evenly across the 50% budget. Without this the
 *   add silently no-ops and a second ingredient can never be picked.
 *
 * Both paths keep the invariants: whole percentages, each 5%..50%, total <= 50%.
 */
function ingredientsWithAddition(
  state: CustomBlendState,
  variantId: number,
): CustomBlendDraftIngredient[] {
  const remaining = MAX_INGREDIENT_TOTAL - ingredientTotalPercentage(state);
  if (remaining >= MIN_INGREDIENT_PERCENTAGE) {
    return [
      ...state.ingredients,
      { variantId, percentage: Math.min(MAX_INGREDIENT_PERCENTAGE, remaining) },
    ];
  }

  const variantIds = [...state.ingredients.map((ingredient) => ingredient.variantId), variantId];
  const balanced = balanceEvenlyPercentages(variantIds);
  return variantIds.map((id) => ({
    variantId: id,
    percentage: balanced.get(id) ?? MIN_INGREDIENT_PERCENTAGE,
  }));
}

function clampedPercentageForIngredient(
  state: CustomBlendState,
  variantId: number,
  requestedPercentage: number,
): number | null {
  const ingredient = state.ingredients.find((item) => item.variantId === variantId);
  if (!ingredient) return null;

  const otherIngredientTotal = ingredientTotalPercentage(state) - ingredient.percentage;
  const maximumForIngredient = Math.min(
    MAX_INGREDIENT_PERCENTAGE,
    MAX_INGREDIENT_TOTAL - otherIngredientTotal,
  );
  if (maximumForIngredient < MIN_INGREDIENT_PERCENTAGE) return null;

  const normalizedPercentage = Number.isFinite(requestedPercentage)
    ? Math.round(requestedPercentage)
    : MIN_INGREDIENT_PERCENTAGE;
  return Math.max(MIN_INGREDIENT_PERCENTAGE, Math.min(maximumForIngredient, normalizedPercentage));
}

export function customBlendReducer(
  state: CustomBlendState,
  event: CustomBlendEvent,
): CustomBlendState {
  switch (event.type) {
    case 'target-changed': {
      // A hydrated edit draft belongs to one URL target. It survives only while the URL still
      // names that target: same base lot and same config key. Anything else — base changed,
      // config key changed, edit mode left — discards the draft, because ingredient
      // compatibility and the replace target are both resolved against the base lot.
      const isSameTarget =
        state.baseVariantId === event.baseVariantId &&
        (state.editConfigKey === null || state.editConfigKey === event.editConfigKey);
      if (isSameTarget) return state;
      return { ...initialCustomBlendState, baseVariantId: event.baseVariantId };
    }
    case 'edit-loaded':
      return {
        baseVariantId: event.baseVariantId,
        editConfigKey: event.configKey,
        lockedQuantity: event.quantity,
        ingredients: event.ingredients.map((ingredient) => ({ ...ingredient })),
      };
    case 'ingredient-toggled': {
      const existing = state.ingredients.find(
        (ingredient) => ingredient.variantId === event.variantId,
      );
      if (existing) {
        return {
          ...state,
          ingredients: state.ingredients.filter(
            (ingredient) => ingredient.variantId !== event.variantId,
          ),
        };
      }
      if (state.ingredients.length >= MAX_INGREDIENTS) return state;
      return {
        ...state,
        ingredients: ingredientsWithAddition(state, event.variantId),
      };
    }
    case 'ingredient-removed':
      return {
        ...state,
        ingredients: state.ingredients.filter(
          (ingredient) => ingredient.variantId !== event.variantId,
        ),
      };
    case 'percentage-changed': {
      const percentage = clampedPercentageForIngredient(state, event.variantId, event.percentage);
      if (percentage === null) return state;
      return {
        ...state,
        ingredients: state.ingredients.map((ingredient) =>
          ingredient.variantId === event.variantId ? { ...ingredient, percentage } : ingredient,
        ),
      };
    }
  }
}

export function ingredientTotalPercentage(state: CustomBlendState): number {
  return state.ingredients.reduce((total, ingredient) => total + ingredient.percentage, 0);
}

/** Live remainder held by the base lot. Derived only; never stored. */
export function derivedBasePercentage(state: CustomBlendState): number {
  return 100 - ingredientTotalPercentage(state);
}

export function isIngredientSelected(state: CustomBlendState, variantId: number): boolean {
  return state.ingredients.some((ingredient) => ingredient.variantId === variantId);
}

/** True once no further ingredient may be picked, used to disable rather than hide options. */
export function isIngredientLimitReached(state: CustomBlendState): boolean {
  return state.ingredients.length >= MAX_INGREDIENTS;
}

/**
 * Splits the available 50% ingredient budget as evenly as possible. Remainder points are assigned
 * in the current draft order, keeping the result deterministic and suitable for a reducer event.
 */
export function balanceEvenlyPercentages(
  variantIds: readonly number[],
): ReadonlyMap<number, number> {
  if (variantIds.length === 0) return new Map();
  const count = Math.min(variantIds.length, MAX_INGREDIENTS);
  const share = Math.floor(MAX_INGREDIENT_TOTAL / count);
  const remainder = MAX_INGREDIENT_TOTAL % count;
  return new Map(
    variantIds
      .slice(0, count)
      .map((variantId, index) => [variantId, share + (index < remainder ? 1 : 0)]),
  );
}

export type CustomBlendValidation = {
  isValid: boolean;
  errors: CustomBlendMessage[];
};

function isWholePercentageInRange(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= MIN_INGREDIENT_PERCENTAGE &&
    value <= MAX_INGREDIENT_PERCENTAGE
  );
}

/** Customer-facing mirror of server blend rules. Errors retain keys/params until render. */
export function customBlendValidation(state: CustomBlendState): CustomBlendValidation {
  const errors: CustomBlendMessage[] = [];

  if (state.baseVariantId === null) {
    errors.push({ key: 'customBlend.validation.chooseBase' });
  }
  if (state.ingredients.length < MIN_INGREDIENTS) {
    errors.push({
      key: 'customBlend.validation.addIngredient',
      params: { minIngredients: MIN_INGREDIENTS },
    });
  }
  if (state.ingredients.length > MAX_INGREDIENTS) {
    errors.push({
      key: 'customBlend.validation.tooManyIngredients',
      params: { maxIngredients: MAX_INGREDIENTS },
    });
  }
  if (state.ingredients.some((ingredient) => !isWholePercentageInRange(ingredient.percentage))) {
    errors.push({
      key: 'customBlend.validation.wholePercentage',
      params: {
        minPercentage: MIN_INGREDIENT_PERCENTAGE,
        maxPercentage: MAX_INGREDIENT_PERCENTAGE,
      },
    });
  }

  const total = ingredientTotalPercentage(state);
  if (total > MAX_INGREDIENT_TOTAL) {
    errors.push({
      key: 'customBlend.validation.ingredientTotal',
      params: { maxTotal: MAX_INGREDIENT_TOTAL, total },
    });
  }

  const basePercentage = derivedBasePercentage(state);
  if (
    errors.length === 0 &&
    (basePercentage < MIN_BASE_PERCENTAGE || basePercentage > MAX_BASE_PERCENTAGE)
  ) {
    errors.push({
      key: 'customBlend.validation.baseRange',
      params: {
        minBase: MIN_BASE_PERCENTAGE,
        maxBase: MAX_BASE_PERCENTAGE,
        base: basePercentage,
      },
    });
  }

  return { isValid: errors.length === 0, errors };
}

/** Ingredient inputs in request shape. Canonical ordering stays a server concern. */
export function toIngredientInputs(state: CustomBlendState): CustomBlendIngredientInput[] {
  return state.ingredients.map((ingredient) => ({
    variantId: ingredient.variantId,
    percentage: ingredient.percentage,
  }));
}

/** Rehydrates a draft from a persisted line specification for editing. */
export function snapshotToDraftIngredients(
  snapshot: CustomBlendSnapshot,
): CustomBlendDraftIngredient[] {
  return snapshot.ingredients.map((ingredient) => ({
    variantId: ingredient.variantId,
    percentage: ingredient.percentage,
  }));
}
