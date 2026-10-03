import { normalizeComparisonIds } from './comparisonSelection';

export const COMPARISON_STORAGE_KEY = 'shop.comparison.product-ids.v1';

export type ComparisonSelectionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function discardCorruptSelection(storage: ComparisonSelectionStorage): void {
  try {
    storage.removeItem(COMPARISON_STORAGE_KEY);
  } catch {
    // Browser privacy settings and quota failures must not break comparison.
  }
}

/** Loads only a complete, valid persisted comparison selection. */
export function loadComparisonSelection(
  storage: ComparisonSelectionStorage | null | undefined,
): string[] | null {
  if (!storage) return null;

  let raw: string | null;
  try {
    raw = storage.getItem(COMPARISON_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;

  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) {
      discardCorruptSelection(storage);
      return null;
    }
    const ids = normalizeComparisonIds(value);
    if (ids === null) {
      discardCorruptSelection(storage);
      return null;
    }
    return ids;
  } catch {
    discardCorruptSelection(storage);
    return null;
  }
}

/** Saves only a complete selection (two to four unique, positive safe IDs). */
export function saveComparisonSelection(
  storage: ComparisonSelectionStorage | null | undefined,
  ids: readonly unknown[],
): boolean {
  if (!storage) return false;
  const normalized = normalizeComparisonIds(ids);
  if (normalized === null) return false;

  try {
    storage.setItem(COMPARISON_STORAGE_KEY, JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}

export function clearComparisonSelection(
  storage: ComparisonSelectionStorage | null | undefined,
): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(COMPARISON_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
