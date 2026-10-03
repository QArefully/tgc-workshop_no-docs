import type { CustomerProductRow } from './productRepository.js';

/** Internal scoring facts retained by the catalog service and never sent over HTTP. */
export interface SimilarityScoreBreakdown {
  category: number;
  tags: number;
  specifications: number;
  price: number;
  availability: number;
  total: number;
  priceDifferenceCents: number;
}

interface ScoredCandidate {
  candidate: CustomerProductRow;
  score: SimilarityScoreBreakdown;
}

function uniqueTagKeys(product: CustomerProductRow): Set<string> {
  return new Set(product.tags.map((tag) => tag.key));
}

/**
 * Maps a specification key to its distinct values. A matching key earns at most
 * once, even if malformed input happens to repeat its metadata.
 */
function specificationValues(product: CustomerProductRow): Map<string, Set<string>> {
  const values = new Map<string, Set<string>>();
  for (const group of product.specificationGroups) {
    for (const specification of group.specifications) {
      const valuesForKey = values.get(specification.key) ?? new Set<string>();
      valuesForKey.add(specification.valueKey);
      values.set(specification.key, valuesForKey);
    }
  }
  return values;
}

function sharedTagCount(source: CustomerProductRow, candidate: CustomerProductRow): number {
  const sourceTags = uniqueTagKeys(source);
  return [...uniqueTagKeys(candidate)].filter((key) => sourceTags.has(key)).length;
}

function matchingSpecificationCount(
  source: CustomerProductRow,
  candidate: CustomerProductRow,
): number {
  const sourceValues = specificationValues(source);
  let count = 0;
  for (const [key, candidateValues] of specificationValues(candidate)) {
    const sourceValuesForKey = sourceValues.get(key);
    if (sourceValuesForKey && [...candidateValues].some((value) => sourceValuesForKey.has(value))) {
      count += 1;
    }
  }
  return count;
}

function priceScore(priceDifferenceCents: number, sourcePriceCents: number): number {
  const denominator = Math.max(sourcePriceCents, 1);
  if (priceDifferenceCents * 10 <= denominator) return 15;
  if (priceDifferenceCents * 4 <= denominator) return 10;
  if (priceDifferenceCents * 2 <= denominator) return 5;
  return 0;
}

/** Scores one candidate. `undefined` means it has no non-availability similarity signal. */
export function scoreProductSimilarity(
  source: CustomerProductRow,
  candidate: CustomerProductRow,
): SimilarityScoreBreakdown | undefined {
  if (source.active !== 1 || candidate.active !== 1 || source.id === candidate.id) return undefined;

  const category = source.category === candidate.category ? 40 : 0;
  const tags = Math.min(sharedTagCount(source, candidate) * 5, 20);
  const specifications = Math.min(matchingSpecificationCount(source, candidate) * 5, 20);
  const priceDifferenceCents = Math.abs(candidate.price_cents - source.price_cents);
  const price = priceScore(priceDifferenceCents, source.price_cents);
  const availability = (candidate.available_to_sell ?? candidate.stock_count) > 0 ? 5 : 0;
  if (category === 0 && tags === 0 && specifications === 0 && price === 0) return undefined;

  return {
    category,
    tags,
    specifications,
    price,
    availability,
    total: Math.min(100, category + tags + specifications + price + availability),
    priceDifferenceCents,
  };
}

function compareScoredCandidates(left: ScoredCandidate, right: ScoredCandidate): number {
  return (
    right.score.total - left.score.total ||
    right.score.category - left.score.category ||
    right.score.specifications - left.score.specifications ||
    right.score.tags - left.score.tags ||
    left.score.priceDifferenceCents - right.score.priceDifferenceCents ||
    left.candidate.id - right.candidate.id
  );
}

/**
 * Ranks active catalog candidates without mutating input. This is the internal
 * service-facing API; score breakdowns remain absent from transport responses.
 */
export function rankSimilarProducts(
  source: CustomerProductRow,
  candidates: readonly CustomerProductRow[],
): CustomerProductRow[] {
  return candidates
    .flatMap((candidate): ScoredCandidate[] => {
      const score = scoreProductSimilarity(source, candidate);
      return score ? [{ candidate, score }] : [];
    })
    .sort(compareScoredCandidates)
    .slice(0, 5)
    .map(({ candidate }) => candidate);
}
