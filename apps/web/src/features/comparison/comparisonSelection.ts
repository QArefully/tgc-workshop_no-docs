export const MIN_COMPARISON_PRODUCTS = 2;
export const MAX_COMPARISON_PRODUCTS = 4;

export type ComparisonSelectionParseResult =
  | { status: 'missing'; ids?: undefined; value?: undefined }
  | { status: 'invalid'; ids?: undefined; value?: undefined }
  | { status: 'valid'; ids: string[]; value: string };

function normalizeId(value: unknown): string | null {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;
  const numericId = Number(value);
  if (!Number.isSafeInteger(numericId) || numericId <= 0) return null;
  return String(numericId);
}

/** Validates an in-progress selection, including an empty draft. */
export function normalizeComparisonDraftIds(ids: readonly unknown[]): string[] | null {
  if (ids.length > MAX_COMPARISON_PRODUCTS) return null;

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const normalizedId = normalizeId(id);
    if (normalizedId === null || seen.has(normalizedId)) return null;
    seen.add(normalizedId);
    normalized.push(normalizedId);
  }
  return normalized;
}

/**
 * Validates a comparison selection without changing its requested order.
 * Returned IDs are canonical decimal strings. Leading-zero forms are rejected
 * to match the shared product-ID transport contract.
 */
export function normalizeComparisonIds(ids: readonly unknown[]): string[] | null {
  if (ids.length < MIN_COMPARISON_PRODUCTS || ids.length > MAX_COMPARISON_PRODUCTS) return null;
  return normalizeComparisonDraftIds(ids);
}

export function serializeComparisonIds(ids: readonly unknown[]): string | null {
  const normalized = normalizeComparisonIds(ids);
  return normalized === null ? null : normalized.join(',');
}

/** Produces one shareable comparison route from a complete selection. */
export function comparisonPath(ids: readonly unknown[]): string | null {
  const serialized = serializeComparisonIds(ids);
  return serialized === null ? null : `/compare?ids=${serialized}`;
}

export type ComparisonDraftChange =
  | { status: 'added'; ids: string[] }
  | { status: 'removed'; ids: string[] }
  | { status: 'at-capacity'; ids: string[] }
  | { status: 'invalid'; ids: string[] };

/** Adds an ID without sorting; a fifth ID leaves the draft unchanged. */
export function addComparisonId(ids: readonly unknown[], id: unknown): ComparisonDraftChange {
  const draft = normalizeComparisonDraftIds(ids);
  const normalizedId = normalizeId(id);
  if (draft === null || normalizedId === null) {
    return { status: 'invalid', ids: draft ?? [] };
  }
  if (draft.includes(normalizedId)) return { status: 'invalid', ids: draft };
  if (draft.length === MAX_COMPARISON_PRODUCTS) return { status: 'at-capacity', ids: draft };
  return { status: 'added', ids: [...draft, normalizedId] };
}

/** Toggles an ID while preserving insertion order for remaining and re-added IDs. */
export function toggleComparisonId(ids: readonly unknown[], id: unknown): ComparisonDraftChange {
  const draft = normalizeComparisonDraftIds(ids);
  const normalizedId = normalizeId(id);
  if (draft === null || normalizedId === null) {
    return { status: 'invalid', ids: draft ?? [] };
  }
  if (draft.includes(normalizedId)) {
    return { status: 'removed', ids: draft.filter((candidateId) => candidateId !== normalizedId) };
  }
  return addComparisonId(draft, normalizedId);
}

/** Clears a draft without touching its last complete persisted selection. */
export function clearComparisonIds(): string[] {
  return [];
}

/**
 * Separates an omitted `ids` parameter from an invalid one so callers can
 * decide whether storage restoration is allowed.
 */
export function parseComparisonSelection(
  searchParams: URLSearchParams,
): ComparisonSelectionParseResult {
  const values = searchParams.getAll('ids');
  if (values.length === 0) return { status: 'missing' };
  if (values.length !== 1) return { status: 'invalid' };

  const raw = values[0] ?? '';
  if (!/^[1-9]\d*(?:,[1-9]\d*){1,3}$/.test(raw)) return { status: 'invalid' };

  const ids = normalizeComparisonIds(raw.split(','));
  if (ids === null) return { status: 'invalid' };
  return { status: 'valid', ids, value: ids.join(',') };
}

// Kept as a short alias for callers that frame this as parsing IDs rather
// than parsing a complete comparison selection.
export const parseComparisonIds = parseComparisonSelection;

/** Removes one ID and keeps every remaining ID in its original order. */
export function removeComparisonId(ids: readonly string[], id: string): string[] {
  return ids.filter((candidateId) => candidateId !== id);
}
