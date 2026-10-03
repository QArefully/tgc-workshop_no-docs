import {
  CATALOG_CATEGORIES,
  MIXING_GROUPS,
  type CatalogCategory,
  type ConsumptionClassification,
} from '@shop/catalog';
import type { UnitOfWork } from '../../db/unitOfWork.js';
import type { AuditContext } from '../audit/auditEvent.js';
import type { AuditWriter, Clock } from '../audit/auditService.js';
import type { ProductRow } from './productRepository.js';
import type { Country } from '@shop/contracts/country';
import { countryProfile } from '@shop/contracts/country-profiles';
import type { CatalogCountryExclusions } from './catalogSql.js';
import type {
  ProductAdminInsert,
  ProductAdminRepository,
  ProductAdminUpdate,
} from './productAdminRepository.js';

export class ProductAdminError extends Error {
  constructor(
    readonly code:
      'PRODUCT_NOT_FOUND' | 'DUPLICATE_SLUG' | 'INVALID_MIXING_GROUP' | 'INVALID_INPUT',
  ) {
    super(code);
    this.name = 'ProductAdminError';
  }
}

export interface ProductAdminCreateInput {
  name: string;
  description: string;
  priceCents: number;
  category: CatalogCategory;
  stockCount: number;
  imageSetId?: string | null;
  slug: string;
  compareAtPriceCents?: number | null;
  consumptionClassification: ConsumptionClassification;
  mixingGroup: string | null;
  detailsJson?: string | null;
}

export interface ProductAdminPatch {
  name?: string;
  description?: string;
  priceCents?: number;
  category?: CatalogCategory;
  stockCount?: number;
  imageSetId?: string | null;
  slug?: string;
  compareAtPriceCents?: number | null;
  consumptionClassification?: ConsumptionClassification;
  mixingGroup?: string | null;
  detailsJson?: string | null;
}

export interface ProductAdminService {
  listAdmin(query?: { includeRetired?: boolean }, country?: Country): ProductRow[];
  getAdmin(id: number, country?: Country): ProductRow | null;
  create(input: ProductAdminCreateInput, context: AuditContext): ProductRow;
  update(id: number, patch: ProductAdminPatch, context: AuditContext): ProductRow;
  retire(id: number, context: AuditContext): ProductRow;
}

export interface ProductAdminServiceDependencies {
  repository: ProductAdminRepository;
  unitOfWork: UnitOfWork;
  audit: AuditWriter;
  clock: Clock;
}

const mixingGroups = new Set<string>(MIXING_GROUPS);
const catalogCategories = new Set<string>(CATALOG_CATEGORIES);

function exclusionsFor(country?: Country): CatalogCountryExclusions | undefined {
  if (!country) return undefined;
  const profile = countryProfile(country);
  return {
    blockedCategories: profile.blockedCategories,
    blockedSlugs: profile.blockedProductSlugs,
  };
}

function assertText(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new ProductAdminError('INVALID_INPUT');
  return normalized;
}

function assertInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new ProductAdminError('INVALID_INPUT');
  return value;
}

function assertCategory(value: string): CatalogCategory {
  if (!catalogCategories.has(value)) throw new ProductAdminError('INVALID_INPUT');
  return value as CatalogCategory;
}

function assertNullableInteger(value: number | null): number | null {
  return value === null ? null : assertInteger(value);
}

function assertConsumptionClassification(value: string): ConsumptionClassification {
  if (value !== 'food' && value !== 'non-food' && value !== 'caution') {
    throw new ProductAdminError('INVALID_INPUT');
  }
  return value;
}

function assertMixingGroup(value: string | null): string | null {
  if (value !== null && !mixingGroups.has(value))
    throw new ProductAdminError('INVALID_MIXING_GROUP');
  return value;
}

function toInsert(input: ProductAdminCreateInput, createdAt: string): ProductAdminInsert {
  return {
    name: assertText(input.name),
    description: assertText(input.description),
    price_cents: assertInteger(input.priceCents),
    category: assertCategory(assertText(input.category)),
    stock_count: assertInteger(input.stockCount),
    image_set_id: input.imageSetId ?? null,
    slug: assertText(input.slug),
    compare_at_price_cents: assertNullableInteger(input.compareAtPriceCents ?? null),
    consumption_classification: assertConsumptionClassification(input.consumptionClassification),
    mixing_group: assertMixingGroup(input.mixingGroup),
    details_json: input.detailsJson ?? null,
    created_at: createdAt,
  };
}

function toPatch(input: ProductAdminPatch): ProductAdminUpdate {
  const patch: ProductAdminUpdate = {};
  if (input.name !== undefined) patch.name = assertText(input.name);
  if (input.description !== undefined) patch.description = assertText(input.description);
  if (input.priceCents !== undefined) patch.price_cents = assertInteger(input.priceCents);
  if (input.category !== undefined) patch.category = assertCategory(assertText(input.category));
  if (input.stockCount !== undefined) patch.stock_count = assertInteger(input.stockCount);
  if (input.imageSetId !== undefined) patch.image_set_id = input.imageSetId;
  if (input.slug !== undefined) patch.slug = assertText(input.slug);
  if (input.compareAtPriceCents !== undefined)
    patch.compare_at_price_cents = assertNullableInteger(input.compareAtPriceCents);
  if (input.consumptionClassification !== undefined) {
    patch.consumption_classification = assertConsumptionClassification(
      input.consumptionClassification,
    );
  }
  if (input.mixingGroup !== undefined) patch.mixing_group = assertMixingGroup(input.mixingGroup);
  if (input.detailsJson !== undefined) patch.details_json = input.detailsJson;
  return patch;
}

/** Admin product writes are transactional with their immutable audit event. */
export function createProductAdminService({
  repository,
  unitOfWork,
  audit,
  clock,
}: ProductAdminServiceDependencies): ProductAdminService {
  const requireProduct = (id: number): ProductRow => {
    const product = repository.findById(id);
    if (!product) throw new ProductAdminError('PRODUCT_NOT_FOUND');
    return product;
  };
  const assertSlugAvailable = (category: string, slug: string, excludeId: number | null): void => {
    const found = repository.findByCategoryAndSlug(category, slug);
    if (found && found.id !== excludeId) throw new ProductAdminError('DUPLICATE_SLUG');
  };

  return {
    listAdmin(query = {}, country) {
      return repository.list(query.includeRetired === true, exclusionsFor(country));
    },
    getAdmin(id, country) {
      return repository.findById(id, exclusionsFor(country)) ?? null;
    },
    create(input, context) {
      return unitOfWork.run(() => {
        const insert = toInsert(input, clock.now().toISOString());
        assertSlugAvailable(insert.category, insert.slug, null);
        const product = repository.insert(insert);
        audit.append({ action: 'product.created', context, productId: product.id });
        return product;
      });
    },
    update(id, input, context) {
      return unitOfWork.run(() => {
        const current = requireProduct(id);
        const patch = toPatch(input);
        const category = patch.category ?? current.category;
        const slug = patch.slug ?? current.slug;
        assertSlugAvailable(category, slug, id);
        repository.update(id, patch);
        const product = requireProduct(id);
        audit.append({ action: 'product.updated', context, productId: product.id });
        return product;
      });
    },
    retire(id, context) {
      return unitOfWork.run(() => {
        requireProduct(id);
        // Product history remains addressable even where historic order lines point at this id.
        repository.retire(id);
        const product = requireProduct(id);
        audit.append({ action: 'product.retired', context, productId: product.id });
        return product;
      });
    },
  };
}
