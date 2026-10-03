import { describe, expect, it } from 'vitest';
import {
  COMPARISON_STORAGE_KEY,
  loadComparisonSelection,
  saveComparisonSelection,
  type ComparisonSelectionStorage,
} from './comparisonStorage';

function memoryStorage(): ComparisonSelectionStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

describe('comparison storage', () => {
  it('round-trips only a valid ordered selection', () => {
    const storage = memoryStorage();
    expect(saveComparisonSelection(storage, ['3', '1', '2'])).toBe(true);
    expect(storage.values.get(COMPARISON_STORAGE_KEY)).toBe('["3","1","2"]');
    expect(loadComparisonSelection(storage)).toEqual(['3', '1', '2']);
  });

  it('does not persist malformed, duplicate, or incomplete selections', () => {
    const storage = memoryStorage();
    expect(saveComparisonSelection(storage, ['1'])).toBe(false);
    expect(saveComparisonSelection(storage, ['1', '1'])).toBe(false);
    expect(saveComparisonSelection(storage, ['1', '0'])).toBe(false);
    expect(saveComparisonSelection(storage, ['01', '2'])).toBe(false);
    expect(storage.values.has(COMPARISON_STORAGE_KEY)).toBe(false);
  });

  it('fails closed and removes corrupt stored JSON', () => {
    const storage = memoryStorage();
    storage.setItem(COMPARISON_STORAGE_KEY, '{not json');
    expect(loadComparisonSelection(storage)).toBeNull();
    expect(storage.values.has(COMPARISON_STORAGE_KEY)).toBe(false);

    storage.setItem(COMPARISON_STORAGE_KEY, JSON.stringify(['1', '1']));
    expect(loadComparisonSelection(storage)).toBeNull();
    expect(storage.values.has(COMPARISON_STORAGE_KEY)).toBe(false);
  });

  it('contains storage exceptions', () => {
    const storage: ComparisonSelectionStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadComparisonSelection(storage)).toBeNull();
    expect(saveComparisonSelection(storage, ['1', '2'])).toBe(false);
  });
});
