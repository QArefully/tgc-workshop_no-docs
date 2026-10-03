import { describe, expect, it } from 'vitest';
import type { CustomBlendSnapshot } from '@shop/contracts/custom-blends';
import {
  balanceEvenlyPercentages,
  customBlendReducer,
  customBlendValidation,
  derivedBasePercentage,
  initialCustomBlendState,
  ingredientTotalPercentage,
  isIngredientLimitReached,
  isIngredientSelected,
  snapshotToDraftIngredients,
  toIngredientInputs,
  type CustomBlendState,
} from './customBlendState';

function stateWith(overrides: Partial<CustomBlendState> = {}): CustomBlendState {
  return { ...initialCustomBlendState, baseVariantId: 501, ...overrides };
}

function ingredients(...percentages: number[]) {
  return percentages.map((percentage, index) => ({ variantId: 600 + index, percentage }));
}

const EDIT_KEY = 'a'.repeat(64);

function loadedEdit(): CustomBlendState {
  return customBlendReducer(initialCustomBlendState, {
    type: 'edit-loaded',
    baseVariantId: 501,
    configKey: EDIT_KEY,
    quantity: 7,
    ingredients: ingredients(15, 10),
  });
}

describe('customBlendReducer', () => {
  it('clears prior ingredient picks when the base lot changes', () => {
    const state = stateWith({ ingredients: ingredients(10, 20) });
    const next = customBlendReducer(state, {
      type: 'target-changed',
      baseVariantId: 502,
      editConfigKey: null,
    });
    expect(next.baseVariantId).toBe(502);
    expect(next.ingredients).toEqual([]);
  });

  it('keeps ingredient picks when the target is unchanged', () => {
    const state = stateWith({ ingredients: ingredients(10) });
    expect(
      customBlendReducer(state, {
        type: 'target-changed',
        baseVariantId: 501,
        editConfigKey: null,
      }),
    ).toBe(state);
  });

  it('clears the base lot when the target loses it', () => {
    const state = stateWith({ ingredients: ingredients(10) });
    const next = customBlendReducer(state, {
      type: 'target-changed',
      baseVariantId: null,
      editConfigKey: null,
    });
    expect(next).toEqual(initialCustomBlendState);
  });

  it('fills the remaining ingredient budget when a lot is picked', () => {
    const first = customBlendReducer(stateWith(), { type: 'ingredient-toggled', variantId: 600 });
    expect(first.ingredients).toEqual([{ variantId: 600, percentage: 50 }]);

    const second = customBlendReducer(
      { ...first, ingredients: [{ variantId: 600, percentage: 30 }] },
      { type: 'ingredient-toggled', variantId: 601 },
    );
    expect(second.ingredients).toEqual([
      { variantId: 600, percentage: 30 },
      { variantId: 601, percentage: 20 },
    ]);
  });

  it('rebalances every ingredient evenly when the remaining budget is below the 5% floor', () => {
    const state = stateWith({ ingredients: ingredients(50) });
    const next = customBlendReducer(state, { type: 'ingredient-toggled', variantId: 700 });
    expect(next.ingredients).toEqual([
      { variantId: 600, percentage: 25 },
      { variantId: 700, percentage: 25 },
    ]);
  });

  it('adds a second, third and fourth ingredient from an empty draft', () => {
    const first = customBlendReducer(stateWith(), { type: 'ingredient-toggled', variantId: 600 });
    expect(first.ingredients).toEqual([{ variantId: 600, percentage: 50 }]);

    const second = customBlendReducer(first, { type: 'ingredient-toggled', variantId: 601 });
    expect(second.ingredients).toEqual([
      { variantId: 600, percentage: 25 },
      { variantId: 601, percentage: 25 },
    ]);

    const third = customBlendReducer(second, { type: 'ingredient-toggled', variantId: 602 });
    expect(third.ingredients).toEqual([
      { variantId: 600, percentage: 17 },
      { variantId: 601, percentage: 17 },
      { variantId: 602, percentage: 16 },
    ]);

    const fourth = customBlendReducer(third, { type: 'ingredient-toggled', variantId: 603 });
    expect(fourth.ingredients).toEqual([
      { variantId: 600, percentage: 13 },
      { variantId: 601, percentage: 13 },
      { variantId: 602, percentage: 12 },
      { variantId: 603, percentage: 12 },
    ]);
    expect(customBlendValidation(fourth).isValid).toBe(true);
  });

  it('keeps tuned percentages when budget remains for the new ingredient', () => {
    const tuned = stateWith({ ingredients: ingredients(20) });
    const next = customBlendReducer(tuned, { type: 'ingredient-toggled', variantId: 601 });
    expect(next.ingredients).toEqual([
      { variantId: 600, percentage: 20 },
      { variantId: 601, percentage: 30 },
    ]);
  });

  it('re-adds an ingredient after it is toggled off', () => {
    const two = customBlendReducer(
      customBlendReducer(stateWith(), { type: 'ingredient-toggled', variantId: 600 }),
      { type: 'ingredient-toggled', variantId: 601 },
    );
    const removed = customBlendReducer(two, { type: 'ingredient-toggled', variantId: 601 });
    expect(removed.ingredients).toEqual([{ variantId: 600, percentage: 25 }]);

    const readded = customBlendReducer(removed, { type: 'ingredient-toggled', variantId: 602 });
    expect(readded.ingredients).toEqual([
      { variantId: 600, percentage: 25 },
      { variantId: 602, percentage: 25 },
    ]);
  });

  it('toggles a selected ingredient back off', () => {
    const state = stateWith({ ingredients: ingredients(10, 20) });
    const next = customBlendReducer(state, { type: 'ingredient-toggled', variantId: 600 });
    expect(next.ingredients.map((item) => item.variantId)).toEqual([601]);
    expect(isIngredientSelected(next, 600)).toBe(false);
  });

  it('refuses a fifth ingredient', () => {
    const state = stateWith({ ingredients: ingredients(5, 5, 5, 5) });
    expect(isIngredientLimitReached(state)).toBe(true);
    expect(customBlendReducer(state, { type: 'ingredient-toggled', variantId: 900 })).toBe(state);
  });

  it('pins the base lot and quantity while the target still names the edited line', () => {
    const loaded = loadedEdit();
    expect(loaded).toMatchObject({
      baseVariantId: 501,
      editConfigKey: EDIT_KEY,
      lockedQuantity: 7,
    });
    expect(
      customBlendReducer(loaded, {
        type: 'target-changed',
        baseVariantId: 501,
        editConfigKey: EDIT_KEY,
      }),
    ).toBe(loaded);
  });

  it('drops the whole edit draft when the target leaves edit mode', () => {
    const next = customBlendReducer(loadedEdit(), {
      type: 'target-changed',
      baseVariantId: 501,
      editConfigKey: null,
    });
    expect(next).toEqual({ ...initialCustomBlendState, baseVariantId: 501 });
  });

  it('drops the whole edit draft when the target moves to another base lot', () => {
    const next = customBlendReducer(loadedEdit(), {
      type: 'target-changed',
      baseVariantId: 602,
      editConfigKey: null,
    });
    expect(next).toEqual({ ...initialCustomBlendState, baseVariantId: 602 });
  });

  it('drops the whole edit draft when the target moves to another configured line', () => {
    const next = customBlendReducer(loadedEdit(), {
      type: 'target-changed',
      baseVariantId: 501,
      editConfigKey: 'b'.repeat(64),
    });
    expect(next).toEqual({ ...initialCustomBlendState, baseVariantId: 501 });
  });

  it('clamps a changed ingredient percentage to the remaining 50% budget', () => {
    const state = stateWith({ ingredients: ingredients(10, 20) });
    const next = customBlendReducer(state, {
      type: 'percentage-changed',
      variantId: 601,
      percentage: 50,
    });
    expect(next.ingredients).toEqual([
      { variantId: 600, percentage: 10 },
      { variantId: 601, percentage: 40 },
    ]);
  });

  it('keeps percentage changes whole and within the 5% to 50% bounds', () => {
    const state = stateWith({ ingredients: ingredients(20) });
    expect(
      customBlendReducer(state, {
        type: 'percentage-changed',
        variantId: 600,
        percentage: 3.6,
      }).ingredients,
    ).toEqual([{ variantId: 600, percentage: 5 }]);
    expect(
      customBlendReducer(state, {
        type: 'percentage-changed',
        variantId: 600,
        percentage: 55,
      }).ingredients,
    ).toEqual([{ variantId: 600, percentage: 50 }]);
  });
});

describe('derived blend facts', () => {
  it('balances one through four ingredients within the 50% budget deterministically', () => {
    expect([...balanceEvenlyPercentages([1])]).toEqual([[1, 50]]);
    expect([...balanceEvenlyPercentages([1, 2])]).toEqual([
      [1, 25],
      [2, 25],
    ]);
    expect([...balanceEvenlyPercentages([1, 2, 3])]).toEqual([
      [1, 17],
      [2, 17],
      [3, 16],
    ]);
    expect([...balanceEvenlyPercentages([1, 2, 3, 4])]).toEqual([
      [1, 13],
      [2, 13],
      [3, 12],
      [4, 12],
    ]);
  });
  it('derives the live base remainder from the ingredient total', () => {
    const state = stateWith({ ingredients: ingredients(15, 10) });
    expect(ingredientTotalPercentage(state)).toBe(25);
    expect(derivedBasePercentage(state)).toBe(75);
  });

  it('reports the boundary remainders of 95% and 50%', () => {
    expect(derivedBasePercentage(stateWith({ ingredients: ingredients(5) }))).toBe(95);
    expect(derivedBasePercentage(stateWith({ ingredients: ingredients(50) }))).toBe(50);
  });

  it('maps draft ingredients to request inputs', () => {
    const state = stateWith({ ingredients: ingredients(15, 10) });
    expect(toIngredientInputs(state)).toEqual([
      { variantId: 600, percentage: 15 },
      { variantId: 601, percentage: 10 },
    ]);
  });

  it('rehydrates draft ingredients from a persisted specification', () => {
    const snapshot = {
      configKey: 'b'.repeat(64),
      basePercentage: 75,
      mixingGroup: 'mineral',
      ingredients: [
        {
          variantId: 610,
          productId: '9',
          productName: 'Chalk Filler',
          productDescription: 'Filler',
          mixingGroup: 'mineral',
          percentage: 25,
        },
      ],
      blendingFeeCents: 2500,
      madeToOrder: true,
      returnable: false,
    } satisfies CustomBlendSnapshot;
    expect(snapshotToDraftIngredients(snapshot)).toEqual([{ variantId: 610, percentage: 25 }]);
  });
});

describe('customBlendValidation', () => {
  it('accepts a blend inside every boundary', () => {
    expect(customBlendValidation(stateWith({ ingredients: ingredients(25, 25) }))).toEqual({
      isValid: true,
      errors: [],
    });
    expect(customBlendValidation(stateWith({ ingredients: ingredients(5) })).isValid).toBe(true);
  });

  it('requires a base lot', () => {
    const state = { ...initialCustomBlendState, ingredients: ingredients(10) };
    expect(customBlendValidation(state).errors).toContainEqual({
      key: 'customBlend.validation.chooseBase',
    });
  });

  it('requires at least one ingredient', () => {
    expect(customBlendValidation(stateWith()).errors).toContainEqual({
      key: 'customBlend.validation.addIngredient',
      params: { minIngredients: 1 },
    });
  });

  it('rejects an ingredient percentage outside 5% to 50%', () => {
    const expected = {
      key: 'customBlend.validation.wholePercentage',
      params: { minPercentage: 5, maxPercentage: 50 },
    };
    expect(customBlendValidation(stateWith({ ingredients: ingredients(4) })).errors).toContainEqual(
      expected,
    );
    expect(
      customBlendValidation(stateWith({ ingredients: ingredients(51) })).errors,
    ).toContainEqual(expected);
    expect(
      customBlendValidation(stateWith({ ingredients: ingredients(12.5) })).errors,
    ).toContainEqual(expected);
  });

  it('rejects an ingredient total above 50%', () => {
    expect(
      customBlendValidation(stateWith({ ingredients: ingredients(30, 25) })).errors,
    ).toContainEqual({
      key: 'customBlend.validation.ingredientTotal',
      params: { maxTotal: 50, total: 55 },
    });
  });

  it('rejects more than four ingredients', () => {
    const state = stateWith({ ingredients: ingredients(5, 5, 5, 5, 5) });
    expect(customBlendValidation(state).errors).toContainEqual({
      key: 'customBlend.validation.tooManyIngredients',
      params: { maxIngredients: 4 },
    });
  });
});
