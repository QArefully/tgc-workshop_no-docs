import type {
  ProductComparisonResponse,
  ProductFilterOptionsResponse,
  ProductQuery,
} from '@shop/contracts/products';
import type { Country } from '@shop/contracts/country';
import type {
  CustomerProductRow,
  ProductList,
  ProductRepository,
  VariantRow,
} from './productRepository.js';
import { buildComparisonItems, parseComparisonIds } from './productComparison.js';
import { rankSimilarProducts } from './productSimilarity.js';
import type { CountryProfileService } from '../countryProfile/countryProfileService.js';

export interface ProductService {
  list(query: ProductQuery, country: Country): ProductList;
  listFilterOptions(country: Country): ProductFilterOptionsResponse;
  findById(id: number, country: Country): CustomerProductRow | undefined;
  findCustomerProductById(id: number, country: Country): CustomerProductRow | undefined;
  listVariants(productId: number, country: Country): VariantRow[];
  listCategories(country: Country): string[];
  listBestsellers(country: Country, limit?: number): CustomerProductRow[];
  compare(rawIds: string, country: Country): ProductComparisonResponse;
  listSimilar(productId: number, country: Country): CustomerProductRow[] | undefined;
  listRelated(productId: number, country: Country): CustomerProductRow[] | undefined;
}

export interface ProductReadDependencies {
  clock: { now(): Date };
  countryProfiles: Pick<CountryProfileService, 'blockedCategoriesFor' | 'blockedSlugsFor'>;
}

export function createProductService(
  repository: ProductRepository,
  dependencies: ProductReadDependencies,
): ProductService {
  const now = (): string => dependencies.clock.now().toISOString();
  const exclusionsFor = (country: Country) => ({
    blockedCategories: dependencies.countryProfiles.blockedCategoriesFor(country),
    blockedSlugs: dependencies.countryProfiles.blockedSlugsFor(country),
  });
  const listSimilar = (productId: number, country: Country): CustomerProductRow[] | undefined => {
    const at = now();
    const exclusions = exclusionsFor(country);
    const source = repository.findActiveById(productId, at, exclusions);
    if (!source) return undefined;
    return rankSimilarProducts(
      source,
      repository.listActiveCandidatesExcluding(source.id, at, exclusions),
    );
  };

  return {
    list: (query, country) => repository.list(query, now(), exclusionsFor(country)),
    listFilterOptions: (country) => repository.listFilterOptions(exclusionsFor(country)),
    findById: (id, country) => repository.findActiveById(id, now(), exclusionsFor(country)),
    findCustomerProductById: (id, country) =>
      repository.findActiveById(id, now(), exclusionsFor(country)),
    listVariants: (productId, country) =>
      repository.findAllVariants(productId, exclusionsFor(country)),
    listCategories: (country) => repository.listCategories(exclusionsFor(country)),
    listBestsellers: (country, limit) =>
      repository.listBestsellers(limit, now(), exclusionsFor(country)),
    compare: (rawIds, country) => {
      const requestedIds = parseComparisonIds(rawIds);
      return buildComparisonItems(
        requestedIds,
        repository.listByIds(requestedIds, now(), exclusionsFor(country)),
      );
    },
    listSimilar,
    listRelated: listSimilar,
  };
}
