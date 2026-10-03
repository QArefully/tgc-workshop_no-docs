import type { AuditContext } from '../audit/auditEvent.js';
import type { Country } from '@shop/contracts/country';
import { countryProfile } from '@shop/contracts/country-profiles';
import type { CatalogCountryExclusions } from './catalogSql.js';
import type { AuditWriter, Clock } from '../audit/auditService.js';
import type { UnitOfWork } from '../../db/unitOfWork.js';
import { noStockObserver, type StockChangeObserver } from '../inventory/stockObserver.js';
import type { DeliveryClass } from '@shop/catalog';
import { resolveClearance } from '../pricing/clearanceRules.js';
import type { VariantRow } from './productRepository.js';
import type {
  ClearanceRecord,
  UpdateVariantRecord,
  VariantAdminRepository,
} from './variantAdminRepository.js';

export class VariantAdminError extends Error {
  constructor(
    readonly code:
      | 'VARIANT_NOT_FOUND'
      | 'INVALID_VARIANT'
      | 'INVALID_CLEARANCE'
      | 'VARIANT_RETIRED'
      | 'VARIANT_NO_ACTIVE_REPLACEMENT',
    message: string,
  ) {
    super(message);
    this.name = 'VariantAdminError';
  }
}

export interface VariantAdminCreateInput {
  productId: number;
  sku: string;
  label: string;
  weightGrams: number;
  priceCents: number;
  stockCount: number;
  backorderable?: boolean;
  backorderLeadDays?: number | null;
  deliveryClass: DeliveryClass;
  sortOrder: number;
  moqSacks: number;
}

export interface VariantAdminUpdateInput {
  sku?: string;
  label?: string;
  weightGrams?: number;
  priceCents?: number;
  stockCount?: number;
  backorderable?: boolean;
  backorderLeadDays?: number | null;
  deliveryClass?: DeliveryClass;
  sortOrder?: number;
  moqSacks?: number;
}

export interface VariantClearanceInput {
  priceCents: number;
  startsAt: string;
  endsAt: string;
}

export interface VariantAdminService {
  listAdmin(productId: number, country?: Country): VariantRow[];
  create(input: VariantAdminCreateInput, context: AuditContext): VariantRow;
  update(id: number, input: VariantAdminUpdateInput, context: AuditContext): VariantRow;
  retire(id: number, context: AuditContext): VariantRow;
  setClearance(
    id: number,
    clearance: VariantClearanceInput | null,
    context: AuditContext,
  ): VariantRow;
}

export interface VariantAdminServiceDependencies {
  repository: VariantAdminRepository;
  unitOfWork: UnitOfWork;
  audit: AuditWriter;
  clock: Clock;
  /**
   * Optional so existing compositions keep their exact behaviour. Notified inside the same
   * unit of work as the stock write, so a rollback discards the signal with the row.
   */
  stockObserver?: StockChangeObserver;
}

function validPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function validNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function exclusionsFor(country?: Country): CatalogCountryExclusions | undefined {
  if (!country) return undefined;
  const profile = countryProfile(country);
  return {
    blockedCategories: profile.blockedCategories,
    blockedSlugs: profile.blockedProductSlugs,
  };
}

function normalizeIsoInstant(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    throw new VariantAdminError('INVALID_CLEARANCE', 'clearance times must be ISO instants');
  }
  return new Date(time).toISOString();
}

function assertVariantValues(input: VariantAdminCreateInput | VariantAdminUpdateInput): void {
  if (input.sku !== undefined && (typeof input.sku !== 'string' || input.sku.trim().length === 0)) {
    throw new VariantAdminError('INVALID_VARIANT', 'sku must be a non-empty string');
  }
  if (
    input.label !== undefined &&
    (typeof input.label !== 'string' || input.label.trim().length === 0)
  ) {
    throw new VariantAdminError('INVALID_VARIANT', 'label must be a non-empty string');
  }
  for (const [field, value] of [
    ['productId', 'productId' in input ? input.productId : undefined],
    ['weightGrams', input.weightGrams],
    ['priceCents', input.priceCents],
    ['sortOrder', input.sortOrder],
    ['moqSacks', input.moqSacks],
  ] as const) {
    if (value !== undefined && !validPositiveInteger(value)) {
      throw new VariantAdminError('INVALID_VARIANT', `${field} must be a positive safe integer`);
    }
  }
  if (input.stockCount !== undefined && !validNonNegativeInteger(input.stockCount)) {
    throw new VariantAdminError(
      'INVALID_VARIANT',
      'stockCount must be a non-negative safe integer',
    );
  }
  if (
    input.deliveryClass !== undefined &&
    input.deliveryClass !== 'parcel' &&
    input.deliveryClass !== 'freight'
  ) {
    throw new VariantAdminError('INVALID_VARIANT', 'deliveryClass must be parcel or freight');
  }
  if (input.backorderable === false && input.backorderLeadDays != null) {
    throw new VariantAdminError('INVALID_VARIANT', 'backorderLeadDays requires backorderable');
  }
  if (input.backorderLeadDays != null && !validPositiveInteger(input.backorderLeadDays)) {
    throw new VariantAdminError(
      'INVALID_VARIANT',
      'backorderLeadDays must be a positive safe integer',
    );
  }
}

function normalizeClearance(input: VariantClearanceInput, variant: VariantRow): ClearanceRecord {
  if (!validPositiveInteger(input.priceCents) || input.priceCents >= variant.price_cents) {
    throw new VariantAdminError(
      'INVALID_CLEARANCE',
      'clearance price must be positive and below list price',
    );
  }
  const startsAt = normalizeIsoInstant(input.startsAt);
  const endsAt = normalizeIsoInstant(input.endsAt);
  if (startsAt >= endsAt) {
    throw new VariantAdminError('INVALID_CLEARANCE', 'clearance startsAt must precede endsAt');
  }
  const resolution = resolveClearance({
    priceCents: variant.price_cents,
    clearancePriceCents: input.priceCents,
    clearanceStartsAt: startsAt,
    clearanceEndsAt: endsAt,
    weightGrams: variant.weight_grams,
    now: new Date(input.startsAt),
  });
  if (!resolution.clearance) {
    throw new VariantAdminError('INVALID_CLEARANCE', 'clearance is not valid for pricing');
  }
  return { priceCents: input.priceCents, startsAt, endsAt, updatedAt: '' };
}

function assertExistingClearanceRemainsValid(variant: VariantRow): void {
  if (variant.clearance_price_cents === null) return;
  normalizeClearance(
    {
      priceCents: variant.clearance_price_cents,
      startsAt: variant.clearance_starts_at!,
      endsAt: variant.clearance_ends_at!,
    },
    variant,
  );
}

export function createVariantAdminService(
  dependencies: VariantAdminServiceDependencies,
): VariantAdminService {
  const stockObserver = dependencies.stockObserver ?? noStockObserver;
  return {
    listAdmin(productId, country) {
      if (!validPositiveInteger(productId)) {
        throw new VariantAdminError('INVALID_VARIANT', 'productId must be a positive safe integer');
      }
      return dependencies.repository.listAdmin(productId, exclusionsFor(country));
    },
    create(input, context) {
      assertVariantValues(input);
      return dependencies.unitOfWork.run(() => {
        const now = dependencies.clock.now().toISOString();
        const variant = dependencies.repository.create({
          ...input,
          backorderable: input.backorderable ?? false,
          backorderLeadDays: input.backorderLeadDays ?? null,
          createdAt: now,
        });
        dependencies.audit.append({ action: 'variant.created', variantId: variant.id, context });
        if (input.stockCount > 0) stockObserver.stockChanged(variant.id, now);
        return variant;
      });
    },
    update(id, input, context) {
      if (!validPositiveInteger(id))
        throw new VariantAdminError('INVALID_VARIANT', 'id must be positive');
      assertVariantValues(input);
      return dependencies.unitOfWork.run(() => {
        const existing = dependencies.repository.findById(id);
        if (!existing) throw new VariantAdminError('VARIANT_NOT_FOUND', 'variant not found');
        if (existing.active === 0)
          throw new VariantAdminError('VARIANT_RETIRED', 'retired variants cannot change');
        const now = dependencies.clock.now().toISOString();
        const patch: UpdateVariantRecord = {
          ...input,
          updatedAt: now,
        };
        const next = {
          ...existing,
          price_cents: input.priceCents ?? existing.price_cents,
          weight_grams: input.weightGrams ?? existing.weight_grams,
        };
        assertExistingClearanceRemainsValid(next);
        const variant = dependencies.repository.update(id, patch)!;
        dependencies.audit.append({ action: 'variant.updated', variantId: variant.id, context });
        if (input.stockCount !== undefined) stockObserver.stockChanged(variant.id, now);
        return variant;
      });
    },
    retire(id, context) {
      if (!validPositiveInteger(id))
        throw new VariantAdminError('INVALID_VARIANT', 'id must be positive');
      return dependencies.unitOfWork.run(() => {
        const existing = dependencies.repository.findById(id);
        if (!existing) throw new VariantAdminError('VARIANT_NOT_FOUND', 'variant not found');
        if (existing.active === 0)
          throw new VariantAdminError('VARIANT_RETIRED', 'variant is already retired');
        const replacement = dependencies.repository.findActiveReplacement(existing.product_id, id);
        if (!replacement) {
          throw new VariantAdminError(
            'VARIANT_NO_ACTIVE_REPLACEMENT',
            'retiring a variant requires an active replacement',
          );
        }
        const variant = dependencies.repository.retire(id, dependencies.clock.now().toISOString())!;
        dependencies.repository.replaceDefaultVariant(
          existing.product_id,
          existing.id,
          replacement.id,
        );
        dependencies.audit.append({ action: 'variant.retired', variantId: variant.id, context });
        return variant;
      });
    },
    setClearance(id, clearance, context) {
      if (!validPositiveInteger(id))
        throw new VariantAdminError('INVALID_VARIANT', 'id must be positive');
      return dependencies.unitOfWork.run(() => {
        const variant = dependencies.repository.findById(id);
        if (!variant) throw new VariantAdminError('VARIANT_NOT_FOUND', 'variant not found');
        if (variant.active === 0)
          throw new VariantAdminError('VARIANT_RETIRED', 'retired variants cannot change');
        const now = dependencies.clock.now().toISOString();
        const normalized =
          clearance === null ? null : { ...normalizeClearance(clearance, variant), updatedAt: now };
        const updated = dependencies.repository.setClearance(id, normalized, now)!;
        dependencies.audit.append({
          action: clearance === null ? 'variant.clearance_cleared' : 'variant.clearance_set',
          variantId: updated.id,
          context,
        });
        return updated;
      });
    },
  };
}
