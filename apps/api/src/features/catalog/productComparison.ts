import type { ProductComparisonResponse } from '@shop/contracts/products';
import { toProductContract } from '../../mappers/product.js';
import type { CustomerProductRow } from './productRepository.js';

/** Deterministic domain error surfaced as a 400 by the comparison endpoint. */
export class ComparisonSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComparisonSelectionError';
  }
}

/** Parses an ordered comparison selection without silently changing user intent. */
export function parseComparisonIds(raw: string): number[] {
  const tokens = raw.split(',');
  if (tokens.length < 2 || tokens.length > 4) {
    throw new ComparisonSelectionError('Comparison requires 2 to 4 product IDs');
  }

  const ids = tokens.map((token) => {
    if (!/^[1-9]\d*$/.test(token)) {
      throw new ComparisonSelectionError('Comparison product IDs must be positive safe integers');
    }
    const id = Number(token);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new ComparisonSelectionError('Comparison product IDs must be positive safe integers');
    }
    return id;
  });
  if (new Set(ids).size !== ids.length) {
    throw new ComparisonSelectionError('Comparison product IDs must be unique');
  }
  return ids;
}

/** Builds the public, ordered mixed-status result without exposing inactive data. */
export function buildComparisonItems(
  requestedIds: readonly number[],
  rows: readonly CustomerProductRow[],
): ProductComparisonResponse {
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  return {
    items: requestedIds.map((id) => {
      const row = rowsById.get(id);
      if (!row) return { id: String(id), status: 'missing' as const };
      if (row.active !== 1) return { id: String(id), status: 'inactive' as const };
      return { id: String(id), status: 'available' as const, product: toProductContract(row) };
    }),
  };
}
