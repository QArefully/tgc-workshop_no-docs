import type { Cart, CartLineVariantSnap } from '@shop/contracts/cart';
import {
  CUSTOM_BLEND_FEE_CENTS,
  CustomBlendSnapshot as CustomBlendSnapshotSchema,
  type CustomBlendSnapshot,
  type ResolvedCustomBlendSnapshot,
} from '@shop/contracts';
import { Value } from '@sinclair/typebox/value';
import { LEGACY_DATA_COUNTRY, type Country } from '@shop/contracts/country';
import { toProductContract } from '../../mappers/product.js';
import type { CartLineRow, CartRepository } from './cartRepository.js';
import type { UnitOfWork } from '../../db/unitOfWork.js';
import type { AuditContext } from '../audit/auditEvent.js';
import type { AuditWriter } from '../audit/auditService.js';
import type { InventoryService } from '../inventory/inventoryService.js';
import type { CountryProfileService } from '../countryProfile/countryProfileService.js';
import {
  minimumOrderQuantity,
  nextTierProgress,
  perTonneCents,
  resolveUnitPriceCents,
  validateMoq,
} from '../pricing/pricingRules.js';
import { resolveClearance } from '../pricing/clearanceRules.js';
import { quoteCartDelivery } from '../delivery/deliveryRules.js';
import {
  calculateCustomBlendLinePricing,
  normalizeCustomBlendSpec,
} from '../customBlend/customBlendRules.js';
import type { CustomBlendResolver } from '../customBlend/customBlendResolver.js';
import {
  aggregateBulkAddDemand,
  classifyBulkAddGroup,
  fanOutBulkAddOutcome,
  type BulkAddGroup,
  type BulkAddOutcome,
  type BulkAddRequest,
} from './cartBulkAddRules.js';

export interface CartAuditDependencies {
  unitOfWork: UnitOfWork;
  audit: AuditWriter;
}

export interface CartAvailabilityDependencies {
  inventory: Pick<InventoryService, 'availableToSell'>;
  clock: { now(): Date };
  countryProfiles?: Pick<CountryProfileService, 'isCategoryBlocked' | 'isProductBlocked'>;
}

/** Whole-request rejection codes for a bulk add; per-line problems are outcomes, not errors. */
export type BulkAddRejection = 'CART_NOT_FOUND' | 'CART_RESERVED';

export interface BulkAddResult {
  cart: Cart;
  /** One outcome per submitted request, in submission order. */
  outcomes: BulkAddOutcome[];
}

export interface CartService {
  create(context?: AuditContext, country?: string): { cartId: string };
  get(cartId: string): Cart | undefined;
  country(cartId: string): Country | undefined;
  blockedInCountry(cartId: string, variantIds: readonly number[]): boolean;
  /**
   * Adds many lines in one transaction with per-line outcomes. Classified skips still commit the
   * lines that succeeded; only an unexpected throw rolls the whole mutation back.
   */
  addMany(
    cartId: string,
    requests: readonly BulkAddRequest[],
    context?: AuditContext,
  ): BulkAddResult | BulkAddRejection;
  add(
    cartId: string,
    variantId: string,
    quantityOrContext?: number | AuditContext,
    context?: AuditContext,
  ):
    | Cart
    | 'CART_NOT_FOUND'
    | 'VARIANT_NOT_FOUND'
    | 'CART_RESERVED'
    | 'BLOCKED_IN_COUNTRY'
    | 'BELOW_MOQ'
    | 'INVALID_QUANTITY';
  update(
    cartId: string,
    variantId: string,
    quantity: number,
    context?: AuditContext,
    configKey?: string,
  ):
    | Cart
    | 'CART_NOT_FOUND'
    | 'VARIANT_NOT_IN_CART'
    | 'CART_RESERVED'
    | 'BELOW_MOQ'
    | 'INVALID_QUANTITY';
  remove(
    cartId: string,
    variantId: string,
    context?: AuditContext,
    configKey?: string,
  ): Cart | 'CART_NOT_FOUND' | 'VARIANT_NOT_IN_CART' | 'CART_RESERVED';
  addConfigured(
    cartId: string,
    variantId: string,
    customBlend: CustomBlendSnapshot,
    quantity: number | undefined,
    context?: AuditContext,
  ):
    | Cart
    | 'CART_NOT_FOUND'
    | 'VARIANT_NOT_FOUND'
    | 'CART_RESERVED'
    | 'BLOCKED_IN_COUNTRY'
    | 'BELOW_MOQ'
    | 'INVALID_QUANTITY';
  replaceConfigured(
    cartId: string,
    variantId: string,
    previousConfigKey: string,
    customBlend: CustomBlendSnapshot,
    context?: AuditContext,
  ): Cart | 'CART_NOT_FOUND' | 'VARIANT_NOT_IN_CART' | 'CART_RESERVED' | 'BLOCKED_IN_COUNTRY';
}

export function createCartService(
  repository: CartRepository,
  auditDependencies?: CartAuditDependencies,
  availabilityDependencies?: CartAvailabilityDependencies,
  customBlendResolver?: CustomBlendResolver,
): CartService {
  return {
    create: (context, country) =>
      runCartMutation(auditDependencies, () => {
        requireAuditContext(auditDependencies, context);
        const result = createCart(repository, country);
        if (context && auditDependencies) {
          auditDependencies.audit.append({
            action: 'cart.created',
            cartId: result.cartId,
            context,
          });
        }
        return result;
      }),
    get: (cartId) => getCart(repository, cartId, availabilityDependencies, customBlendResolver),
    country: (cartId) => repository.country(cartId),
    blockedInCountry: (cartId, variantIds) =>
      blockedInCountry(repository, cartId, variantIds, availabilityDependencies),
    addMany: (cartId, requests, context) => {
      if (!auditDependencies) throw new Error('Cart audit dependencies are required for bulk add');
      if (!availabilityDependencies) {
        throw new Error('Cart availability dependencies are required for bulk add');
      }
      return runCartMutation(auditDependencies, () => {
        requireAuditContext(auditDependencies, context);
        return addManyItems(
          repository,
          cartId,
          requests,
          availabilityDependencies,
          auditDependencies,
          context!,
          customBlendResolver,
        );
      });
    },
    add: (cartId, variantId, quantityOrContext, context) =>
      runCartMutation(auditDependencies, () => {
        const quantity = typeof quantityOrContext === 'number' ? quantityOrContext : undefined;
        const auditContext = typeof quantityOrContext === 'number' ? context : quantityOrContext;
        requireAuditContext(auditDependencies, auditContext);
        const result = addItem(
          repository,
          cartId,
          variantId,
          quantity,
          availabilityDependencies,
          customBlendResolver,
        );
        if (auditContext && auditDependencies && typeof result !== 'string') {
          auditDependencies.audit.append({
            action: 'cart.product_added',
            cartId,
            productId: Number(variantId),
            quantity:
              result.items.find((item) => item.variantSnap?.variantId === Number(variantId))
                ?.quantity ?? 1,
            context: auditContext,
          });
        }
        return result;
      }),
    update: (cartId, variantId, quantity, context, configKey = '') =>
      runCartMutation(auditDependencies, () => {
        requireAuditContext(auditDependencies, context);
        const result = updateItem(
          repository,
          cartId,
          variantId,
          quantity,
          availabilityDependencies,
          configKey,
          customBlendResolver,
        );
        if (context && auditDependencies && typeof result !== 'string') {
          auditDependencies.audit.append(
            quantity === 0
              ? {
                  action: 'cart.product_removed',
                  cartId,
                  productId: Number(variantId),
                  context,
                }
              : {
                  action: 'cart.product_quantity_changed',
                  cartId,
                  productId: Number(variantId),
                  quantity,
                  context,
                },
          );
        }
        return result;
      }),
    remove: (cartId, variantId, context, configKey = '') =>
      runCartMutation(auditDependencies, () => {
        requireAuditContext(auditDependencies, context);
        const result = removeItem(
          repository,
          cartId,
          variantId,
          availabilityDependencies,
          configKey,
          customBlendResolver,
        );
        if (context && auditDependencies && typeof result !== 'string') {
          auditDependencies.audit.append({
            action: 'cart.product_removed',
            cartId,
            productId: Number(variantId),
            context,
          });
        }
        return result;
      }),
    addConfigured: (cartId, variantId, customBlend, quantity, context) =>
      runCartMutation(auditDependencies, () => {
        requireAuditContext(auditDependencies, context);
        const result = addConfiguredItem(
          repository,
          cartId,
          variantId,
          customBlend,
          quantity,
          availabilityDependencies,
          customBlendResolver,
        );
        if (context && auditDependencies && typeof result !== 'string') {
          auditDependencies.audit.append({
            action: 'cart.product_added',
            cartId,
            productId: Number(variantId),
            quantity:
              result.items.find(
                (item) =>
                  item.variantSnap?.variantId === Number(variantId) &&
                  item.configKey === customBlend.configKey,
              )?.quantity ?? 1,
            context,
          });
        }
        return result;
      }),
    replaceConfigured: (cartId, variantId, previousConfigKey, customBlend, context) =>
      runCartMutation(auditDependencies, () => {
        requireAuditContext(auditDependencies, context);
        const result = replaceConfiguredItem(
          repository,
          cartId,
          variantId,
          previousConfigKey,
          customBlend,
          availabilityDependencies,
          customBlendResolver,
        );
        if (context && auditDependencies && typeof result !== 'string') {
          const changed = result.items.find(
            (item) =>
              item.variantSnap?.variantId === Number(variantId) &&
              item.configKey === customBlend.configKey,
          );
          if (changed) {
            auditDependencies.audit.append({
              action: 'cart.product_quantity_changed',
              cartId,
              productId: Number(variantId),
              quantity: changed.quantity,
              context,
            });
          }
        }
        return result;
      }),
  };
}

function runCartMutation<T>(dependencies: CartAuditDependencies | undefined, work: () => T): T {
  return dependencies ? dependencies.unitOfWork.run(work) : work();
}

function requireAuditContext(
  dependencies: CartAuditDependencies | undefined,
  context: AuditContext | undefined,
): void {
  if (dependencies && !context) throw new Error('Cart audit context is required');
}

export function createCart(repository: CartRepository, country?: string): { cartId: string } {
  const cartId = crypto.randomUUID();
  repository.create(cartId, country ?? LEGACY_DATA_COUNTRY);
  return { cartId };
}

function cartLineRowToProductBase(row: CartLineRow) {
  return {
    id: row.product_id,
    name: row.product_name,
    description: row.product_description,
    price_cents: row.price_cents,
    category: row.product_category,
    stock_count: 0,
    image_set_id: row.product_image_set_id,
    slug: row.product_slug,
    compare_at_price_cents: row.product_compare_at_price_cents,
    sales_count: row.product_sales_count,
    active: row.product_active,
    created_at: row.product_created_at,
    consumption_classification: row.product_consumption_classification,
    mixing_group: null,
    details_json: null,
    default_variant_id: row.product_default_variant_id,
    blend_source_variant_id: row.product_blend_source_variant_id,
  };
}

function toVariantSnap(row: CartLineRow): CartLineVariantSnap {
  return {
    variantId: row.variant_id,
    sku: row.variant_sku,
    label: row.variant_label,
    weightGrams: row.variant_weight_grams,
    deliveryClass: row.variant_delivery_class as CartLineVariantSnap['deliveryClass'],
  };
}

export function getCart(
  repository: CartRepository,
  cartId: string,
  availabilityDependencies?: CartAvailabilityDependencies,
  customBlendResolver?: CustomBlendResolver,
): Cart | undefined {
  if (!repository.exists(cartId)) return undefined;
  const rows = repository.listLines(cartId);
  const variantIds = rows.map((row) => row.variant_id);
  const now = availabilityDependencies?.clock.now();
  const availability = availabilityDependencies
    ? availabilityDependencies.inventory.availableToSell(variantIds, now!.toISOString())
    : undefined;
  const availableByVariant = new Map(availability?.map((v) => [v.variantId, v.availableToSell]));
  const customBlends = new Map<number, CustomBlendSnapshot | ResolvedCustomBlendSnapshot>();
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    if (row.config_key === '') {
      if (row.custom_blend_json !== null) return undefined;
      continue;
    }
    const customBlend = hydrateCustomBlend(row, customBlendResolver);
    if (!customBlend) return undefined;
    customBlends.set(index, customBlend);
  }
  const items = rows.map((row, index) => {
    const productBase = cartLineRowToProductBase(row);
    const available = availableByVariant.get(row.variant_id) ?? 0;
    const variantBackorderable = row.variant_backorderable === 1;
    const clearanceResolution = now
      ? resolveClearance({
          priceCents: row.price_cents,
          clearancePriceCents: row.variant_clearance_price_cents ?? null,
          clearanceStartsAt: row.variant_clearance_starts_at ?? null,
          clearanceEndsAt: row.variant_clearance_ends_at ?? null,
          weightGrams: row.variant_weight_grams,
          now,
        })
      : { basePriceCents: row.price_cents, clearance: null };
    const customBlend = customBlends.get(index);
    const resolvedBlend = isResolvedCustomBlendSnapshot(customBlend) ? customBlend : undefined;
    const resolvedBasePriceCents = resolvedBlend
      ? (resolvedBlend.components[0]?.sourceUnitPriceCents ?? row.price_cents)
      : (clearanceResolution.clearance?.priceCents ?? clearanceResolution.basePriceCents);
    const unitPriceCents = resolvedBlend
      ? resolvedBlend.materialUnitPriceCents
      : resolveUnitPriceCents(resolvedBasePriceCents, row.quantity, row.variant_weight_grams);
    const pricing = resolvedBlend
      ? {
          materialSubtotalCents: resolvedBlend.materialSubtotalCents,
          blendingFeeCents: resolvedBlend.blendingFeeCents,
          discountableTotalCents: resolvedBlend.discountableTotalCents,
          lineTotalCents: resolvedBlend.lineTotalCents,
        }
      : customBlend
        ? calculateCustomBlendLinePricing(
            unitPriceCents,
            row.quantity,
            customBlend.blendingFeeCents,
          )
        : {
            materialSubtotalCents: unitPriceCents * row.quantity,
            blendingFeeCents: 0,
            discountableTotalCents: unitPriceCents * row.quantity,
            lineTotalCents: unitPriceCents * row.quantity,
          };
    const tierProgress = customBlend
      ? undefined
      : nextTierProgress(row.quantity, row.variant_weight_grams);
    const product = toProductContract({
      ...productBase,
      available_to_sell: available,
      backorderable: variantBackorderable ? 1 : 0,
      backorder_lead_days: row.variant_backorder_lead_days,
      ...(resolvedBlend ? { consumption_classification: resolvedBlend.resultClassification } : {}),
    });
    return {
      productId: String(row.product_id),
      configKey: row.config_key,
      product,
      variantSnap: toVariantSnap(row),
      perTonneCents: perTonneCents(resolvedBasePriceCents, row.variant_weight_grams),
      resolvedUnitPriceCents: unitPriceCents,
      ...(tierProgress ? { nextTierProgress: tierProgress } : {}),
      ...(resolvedBlend
        ? resolvedBlend.components[0]?.clearance
          ? { clearance: resolvedBlend.components[0].clearance }
          : {}
        : clearanceResolution.clearance
          ? { clearance: clearanceResolution.clearance }
          : {}),
      quantity: row.quantity,
      ...pricing,
      ...(customBlend ? { customBlend } : {}),
    };
  });
  return {
    id: cartId,
    items,
    subtotalCents: items.reduce((total, item) => total + item.lineTotalCents, 0),
    discountableSubtotalCents: items.reduce(
      (total, item) => total + item.discountableTotalCents,
      0,
    ),
    blendingFeeTotalCents: items.reduce((total, item) => total + item.blendingFeeCents, 0),
    totalItems: items.reduce((total, item) => total + item.quantity, 0),
    deliveryPreview: quoteCartDelivery({ items }),
  };
}

function isResolvedCustomBlendSnapshot(
  customBlend: CustomBlendSnapshot | ResolvedCustomBlendSnapshot | undefined,
): customBlend is ResolvedCustomBlendSnapshot {
  return (
    customBlend !== undefined &&
    'ruleVersion' in customBlend &&
    customBlend.ruleVersion === 1 &&
    'materialUnitPriceCents' in customBlend
  );
}

/** Corrupt or retired configured facts invalidate the complete cart before any payment path. */
function hydrateCustomBlend(
  row: CartLineRow,
  customBlendResolver?: CustomBlendResolver,
): CustomBlendSnapshot | ResolvedCustomBlendSnapshot | undefined {
  if (!row.custom_blend_json) return undefined;
  if (customBlendResolver) {
    try {
      return customBlendResolver.rehydrate(row.variant_id, row.custom_blend_json, row.quantity);
    } catch {
      return undefined;
    }
  }
  let persisted: CustomBlendSnapshot;
  try {
    persisted = Value.Parse(CustomBlendSnapshotSchema, JSON.parse(row.custom_blend_json));
  } catch {
    return undefined;
  }
  if (
    persisted.configKey !== row.config_key ||
    persisted.blendingFeeCents !== CUSTOM_BLEND_FEE_CENTS
  ) {
    return undefined;
  }
  let normalized;
  try {
    normalized = normalizeCustomBlendSpec(row.variant_id, persisted.ingredients);
  } catch {
    return undefined;
  }
  if (
    normalized.configKey !== row.config_key ||
    normalized.basePercentage !== persisted.basePercentage
  ) {
    return undefined;
  }
  return persisted;
}

export function addItem(
  repository: CartRepository,
  cartId: string,
  variantId: string,
  quantity?: number,
  availabilityDependencies?: CartAvailabilityDependencies,
  customBlendResolver?: CustomBlendResolver,
):
  | Cart
  | 'CART_NOT_FOUND'
  | 'VARIANT_NOT_FOUND'
  | 'CART_RESERVED'
  | 'BLOCKED_IN_COUNTRY'
  | 'BELOW_MOQ'
  | 'INVALID_QUANTITY' {
  if (!repository.exists(cartId)) return 'CART_NOT_FOUND';
  if (!getCart(repository, cartId, availabilityDependencies, customBlendResolver))
    return 'CART_NOT_FOUND';
  if (repository.isReserved(cartId, availabilityDependencies?.clock.now().toISOString()))
    return 'CART_RESERVED';
  if (blockedInCountry(repository, cartId, [Number(variantId)], availabilityDependencies)) {
    return 'BLOCKED_IN_COUNTRY';
  }
  if (!repository.variantExists(variantId)) return 'VARIANT_NOT_FOUND';
  const variant = repository.getVariant(Number(variantId));
  if (!variant) return 'VARIANT_NOT_FOUND';
  const addedQuantity = quantity ?? minimumMoqQuantity(variant.weight_grams, variant.moq_sacks);
  if (addedQuantity === undefined) return 'INVALID_QUANTITY';
  const nextQuantity = repository.lineQuantity(cartId, variantId) + addedQuantity;
  if (!supportsCartLineArithmetic(variant, nextQuantity)) return 'INVALID_QUANTITY';
  if (!validateMoq(nextQuantity, variant.weight_grams, variant.moq_sacks)) {
    return 'BELOW_MOQ';
  }
  repository.addLineQuantity(cartId, variantId, addedQuantity);
  repository.touch(cartId);
  return (
    getCart(repository, cartId, availabilityDependencies, customBlendResolver) ?? 'CART_NOT_FOUND'
  );
}

export function addConfiguredItem(
  repository: CartRepository,
  cartId: string,
  variantId: string,
  customBlend: CustomBlendSnapshot,
  quantity: number | undefined,
  availabilityDependencies?: CartAvailabilityDependencies,
  customBlendResolver?: CustomBlendResolver,
):
  | Cart
  | 'CART_NOT_FOUND'
  | 'VARIANT_NOT_FOUND'
  | 'CART_RESERVED'
  | 'BLOCKED_IN_COUNTRY'
  | 'BELOW_MOQ'
  | 'INVALID_QUANTITY' {
  if (!repository.exists(cartId)) return 'CART_NOT_FOUND';
  if (!getCart(repository, cartId, availabilityDependencies, customBlendResolver))
    return 'CART_NOT_FOUND';
  if (repository.isReserved(cartId, availabilityDependencies?.clock.now().toISOString())) {
    return 'CART_RESERVED';
  }
  const variant = repository.getVariant(Number(variantId));
  if (!variant || !repository.variantExists(variantId)) return 'VARIANT_NOT_FOUND';
  const addedQuantity = quantity ?? minimumMoqQuantity(variant.weight_grams, variant.moq_sacks);
  if (addedQuantity === undefined) return 'INVALID_QUANTITY';
  const nextQuantity =
    repository.lineQuantity(cartId, variantId, customBlend.configKey) + addedQuantity;
  if (!Number.isSafeInteger(nextQuantity) || nextQuantity < 1) return 'INVALID_QUANTITY';
  if (!customBlendResolver && !supportsCartLineArithmetic(variant, nextQuantity)) {
    return 'INVALID_QUANTITY';
  }
  if (!validateMoq(nextQuantity, variant.weight_grams, variant.moq_sacks)) return 'BELOW_MOQ';
  let resolved: ResolvedCustomBlendSnapshot | undefined;
  if (customBlendResolver) {
    try {
      resolved = customBlendResolver.rehydrate(Number(variantId), customBlend, nextQuantity);
    } catch {
      return 'VARIANT_NOT_FOUND';
    }
    if (!supportsResolvedBlendArithmetic(resolved)) return 'INVALID_QUANTITY';
  }
  const componentVariantIds = [
    Number(variantId),
    ...(resolved ?? customBlend).ingredients.map((ingredient) => ingredient.variantId),
  ];
  if (blockedInCountry(repository, cartId, componentVariantIds, availabilityDependencies)) {
    return 'BLOCKED_IN_COUNTRY';
  }
  const persisted = resolved ? customBlendResolver!.toPersistedSpec(resolved) : customBlend;
  repository.addConfiguredLineQuantity(
    cartId,
    variantId,
    customBlend.configKey,
    JSON.stringify(persisted),
    addedQuantity,
  );
  repository.touch(cartId);
  const cart = getCart(repository, cartId, availabilityDependencies, customBlendResolver);
  if (!cart && customBlendResolver) {
    throw new Error('Custom Blend resolution failed after cart mutation.');
  }
  return cart ?? 'CART_NOT_FOUND';
}

/** Re-derives a bulk/reorder blend from the singleton resolver at its post-add quantity. */
function resolveBulkAddBlend(
  variantId: number,
  supplied: CustomBlendSnapshot,
  quantity: number,
  customBlendResolver?: CustomBlendResolver,
): CustomBlendSnapshot | ResolvedCustomBlendSnapshot | undefined {
  if (customBlendResolver) {
    try {
      return customBlendResolver.rehydrate(variantId, supplied, quantity);
    } catch {
      return undefined;
    }
  }
  // Direct callers predating resolver injection still receive the old opaque specification path.
  try {
    const normalized = normalizeCustomBlendSpec(variantId, supplied.ingredients);
    return normalized.configKey === supplied.configKey ? supplied : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Adds many lines at once. Ordinary and configured lines share one stock pre-flight, one cart
 * touch, and one transaction; a line that fails classification is skipped without disturbing the
 * rest. Each line is added at its full ordered quantity or not at all.
 */
export function addManyItems(
  repository: CartRepository,
  cartId: string,
  requests: readonly BulkAddRequest[],
  availabilityDependencies: CartAvailabilityDependencies,
  auditDependencies: CartAuditDependencies,
  context: AuditContext,
  customBlendResolver?: CustomBlendResolver,
): BulkAddResult | BulkAddRejection {
  if (!repository.exists(cartId)) return 'CART_NOT_FOUND';
  if (!getCart(repository, cartId, availabilityDependencies, customBlendResolver))
    return 'CART_NOT_FOUND';
  const now = availabilityDependencies.clock.now();
  if (repository.isReserved(cartId, now.toISOString())) return 'CART_RESERVED';

  const groups = aggregateBulkAddDemand(requests);
  const variantIds = [...new Set(groups.map((group) => group.variantId))];
  const availability = new Map(
    availabilityDependencies.inventory
      .availableToSell(variantIds, now.toISOString())
      .map((row) => [row.variantId, row]),
  );

  const outcomeByIdentity = new Map<string, BulkAddOutcome[]>();
  const applied: Array<{
    group: BulkAddGroup;
    blend: CustomBlendSnapshot | ResolvedCustomBlendSnapshot | undefined;
    resultingQuantity: number;
  }> = [];
  for (const group of groups) {
    const variant = repository.variantExists(String(group.variantId))
      ? repository.getVariant(group.variantId)
      : undefined;
    const existingQuantity = repository.lineQuantity(
      cartId,
      String(group.variantId),
      group.configKey,
    );
    const canResolveQuantity =
      Number.isSafeInteger(existingQuantity) &&
      existingQuantity >= 0 &&
      Number.isSafeInteger(group.requestedQuantity) &&
      group.requestedQuantity >= 1 &&
      Number.isSafeInteger(existingQuantity + group.requestedQuantity);
    const blend =
      group.customBlend && canResolveQuantity
        ? resolveBulkAddBlend(
            group.variantId,
            group.customBlend,
            existingQuantity + group.requestedQuantity,
            customBlendResolver,
          )
        : undefined;
    const availabilityRow = availability.get(group.variantId);
    const classification = classifyBulkAddGroup({
      blockedInCountry: blockedInCountry(
        repository,
        cartId,
        [
          group.variantId,
          ...(group.customBlend?.ingredients.map((ingredient) => ingredient.variantId) ?? []),
        ],
        availabilityDependencies,
      ),
      variantRow: variant,
      existingQuantity,
      requestedQuantity: group.requestedQuantity,
      availability: availabilityRow
        ? {
            availableToSell: availabilityRow.availableToSell,
            backorderable: availabilityRow.backorderable,
          }
        : undefined,
      ...(group.customBlend ? { blendValid: canResolveQuantity ? blend !== undefined : true } : {}),
      ...(group.customBlend && isResolvedCustomBlendSnapshot(blend)
        ? { resolvedBlend: blend }
        : {}),
      now,
    });
    outcomeByIdentity.set(
      `${group.variantId} ${group.configKey}`,
      fanOutBulkAddOutcome(group, classification),
    );
    if (classification.status === 'added') {
      applied.push({ group, blend, resultingQuantity: classification.resultingQuantity });
    }
  }

  for (const { group, blend } of applied) {
    if (blend) {
      const persisted =
        customBlendResolver && isResolvedCustomBlendSnapshot(blend)
          ? customBlendResolver.toPersistedSpec(blend)
          : blend;
      repository.addConfiguredLineQuantity(
        cartId,
        String(group.variantId),
        blend.configKey,
        JSON.stringify(persisted),
        group.requestedQuantity,
      );
    } else {
      repository.addLineQuantity(cartId, String(group.variantId), group.requestedQuantity);
    }
  }
  if (applied.length > 0) {
    repository.touch(cartId);
    for (const { group, resultingQuantity } of applied) {
      auditDependencies.audit.append({
        action: 'cart.product_added',
        cartId,
        productId: group.variantId,
        // `cart.product_added` metadata carries the post-add cumulative line quantity, matching
        // the single-line `add`/`addConfigured` emitters — not the delta this request contributed.
        quantity: resultingQuantity,
        context,
      });
    }
  }

  const cart = getCart(repository, cartId, availabilityDependencies, customBlendResolver);
  if (!cart && customBlendResolver) {
    throw new Error('Custom Blend resolution failed after bulk cart mutation.');
  }
  if (!cart) return 'CART_NOT_FOUND';
  const cursorByIdentity = new Map<string, number>();
  const outcomes = requests.map((request) => {
    const identity = `${request.variantId} ${request.customBlend?.configKey ?? ''}`;
    const cursor = cursorByIdentity.get(identity) ?? 0;
    cursorByIdentity.set(identity, cursor + 1);
    const outcome = outcomeByIdentity.get(identity)?.[cursor];
    if (!outcome) throw new Error('Bulk add outcome is missing for a submitted request');
    return outcome;
  });
  return { cart, outcomes };
}

function minimumMoqQuantity(weightGrams: number, moqSacks: number): number | undefined {
  return minimumOrderQuantity(weightGrams, moqSacks);
}

function supportsResolvedBlendArithmetic(resolved: ResolvedCustomBlendSnapshot): boolean {
  if (
    Number.isSafeInteger(resolved.quantity) &&
    resolved.quantity > 0 &&
    Number.isSafeInteger(resolved.materialUnitPriceCents) &&
    resolved.materialUnitPriceCents >= 0 &&
    Number.isSafeInteger(resolved.materialSubtotalCents) &&
    resolved.materialSubtotalCents >= 0 &&
    Number.isSafeInteger(resolved.blendingFeeCents) &&
    resolved.blendingFeeCents >= 0 &&
    Number.isSafeInteger(resolved.lineTotalCents) &&
    resolved.lineTotalCents >= resolved.materialSubtotalCents
  ) {
    const expectedMaterialSubtotal =
      resolved.materialUnitPriceCents <= Math.floor(Number.MAX_SAFE_INTEGER / resolved.quantity)
        ? resolved.materialUnitPriceCents * resolved.quantity
        : undefined;
    const expectedLineTotal =
      expectedMaterialSubtotal !== undefined &&
      resolved.blendingFeeCents <= Number.MAX_SAFE_INTEGER - expectedMaterialSubtotal
        ? expectedMaterialSubtotal + resolved.blendingFeeCents
        : undefined;
    return (
      expectedMaterialSubtotal !== undefined &&
      expectedMaterialSubtotal === resolved.materialSubtotalCents &&
      resolved.discountableTotalCents === resolved.materialSubtotalCents &&
      expectedLineTotal === resolved.lineTotalCents
    );
  }
  return false;
}

function supportsCartLineArithmetic(
  variant: { weight_grams: number; price_cents: number },
  quantity: number,
): boolean {
  if (
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    !Number.isSafeInteger(variant.weight_grams) ||
    variant.weight_grams < 1 ||
    !Number.isSafeInteger(variant.price_cents) ||
    variant.price_cents < 0 ||
    quantity > Math.floor(Number.MAX_SAFE_INTEGER / variant.weight_grams) ||
    variant.price_cents > Math.floor(Number.MAX_SAFE_INTEGER / 100) ||
    (variant.price_cents > 0 &&
      quantity > Math.floor(Number.MAX_SAFE_INTEGER / variant.price_cents))
  ) {
    return false;
  }
  return true;
}

export function updateItem(
  repository: CartRepository,
  cartId: string,
  variantId: string,
  quantity: number,
  availabilityDependencies?: CartAvailabilityDependencies,
  configKey = '',
  customBlendResolver?: CustomBlendResolver,
):
  | Cart
  | 'CART_NOT_FOUND'
  | 'VARIANT_NOT_IN_CART'
  | 'CART_RESERVED'
  | 'BELOW_MOQ'
  | 'INVALID_QUANTITY' {
  if (!repository.exists(cartId)) return 'CART_NOT_FOUND';
  if (!getCart(repository, cartId, availabilityDependencies, customBlendResolver))
    return 'CART_NOT_FOUND';
  if (repository.isReserved(cartId, availabilityDependencies?.clock.now().toISOString()))
    return 'CART_RESERVED';
  if (quantity !== 0) {
    if (repository.lineQuantity(cartId, variantId, configKey) === 0) return 'VARIANT_NOT_IN_CART';
    const variant = repository.getVariant(Number(variantId));
    if (!variant) return 'VARIANT_NOT_IN_CART';
    if (configKey === '' || !customBlendResolver) {
      if (!supportsCartLineArithmetic(variant, quantity)) return 'INVALID_QUANTITY';
    } else {
      const row = repository
        .listLines(cartId)
        .find(
          (candidate) =>
            candidate.variant_id === Number(variantId) && candidate.config_key === configKey,
        );
      if (!row?.custom_blend_json) return 'VARIANT_NOT_IN_CART';
      try {
        const resolved = customBlendResolver.rehydrate(
          Number(variantId),
          row.custom_blend_json,
          quantity,
        );
        if (!supportsResolvedBlendArithmetic(resolved)) return 'INVALID_QUANTITY';
      } catch {
        return 'INVALID_QUANTITY';
      }
    }
    if (!validateMoq(quantity, variant.weight_grams, variant.moq_sacks)) return 'BELOW_MOQ';
  }
  const changed =
    quantity === 0
      ? repository.removeLine(cartId, variantId, configKey)
      : repository.updateLine(cartId, variantId, quantity, configKey);
  if (!changed) return 'VARIANT_NOT_IN_CART';
  repository.touch(cartId);
  const cart = getCart(repository, cartId, availabilityDependencies, customBlendResolver);
  if (!cart && customBlendResolver && configKey !== '') {
    throw new Error('Custom Blend resolution failed after cart mutation.');
  }
  return cart ?? 'CART_NOT_FOUND';
}

export function removeItem(
  repository: CartRepository,
  cartId: string,
  variantId: string,
  availabilityDependencies?: CartAvailabilityDependencies,
  configKey = '',
  customBlendResolver?: CustomBlendResolver,
): Cart | 'CART_NOT_FOUND' | 'VARIANT_NOT_IN_CART' | 'CART_RESERVED' {
  if (!repository.exists(cartId)) return 'CART_NOT_FOUND';
  if (!getCart(repository, cartId, availabilityDependencies, customBlendResolver))
    return 'CART_NOT_FOUND';
  if (repository.isReserved(cartId, availabilityDependencies?.clock.now().toISOString()))
    return 'CART_RESERVED';
  if (!repository.removeLine(cartId, variantId, configKey)) return 'VARIANT_NOT_IN_CART';
  repository.touch(cartId);
  return (
    getCart(repository, cartId, availabilityDependencies, customBlendResolver) ?? 'CART_NOT_FOUND'
  );
}

export function replaceConfiguredItem(
  repository: CartRepository,
  cartId: string,
  variantId: string,
  previousConfigKey: string,
  customBlend: CustomBlendSnapshot,
  availabilityDependencies?: CartAvailabilityDependencies,
  customBlendResolver?: CustomBlendResolver,
): Cart | 'CART_NOT_FOUND' | 'VARIANT_NOT_IN_CART' | 'CART_RESERVED' | 'BLOCKED_IN_COUNTRY' {
  if (!repository.exists(cartId)) return 'CART_NOT_FOUND';
  if (!getCart(repository, cartId, availabilityDependencies, customBlendResolver))
    return 'CART_NOT_FOUND';
  if (repository.isReserved(cartId, availabilityDependencies?.clock.now().toISOString())) {
    return 'CART_RESERVED';
  }
  const existingQuantity = repository.lineQuantity(cartId, variantId, previousConfigKey);
  if (existingQuantity === 0) return 'VARIANT_NOT_IN_CART';
  let resolved: ResolvedCustomBlendSnapshot | undefined;
  if (customBlendResolver) {
    try {
      resolved = customBlendResolver.rehydrate(Number(variantId), customBlend, existingQuantity);
    } catch {
      return 'VARIANT_NOT_IN_CART';
    }
    if (!supportsResolvedBlendArithmetic(resolved)) return 'VARIANT_NOT_IN_CART';
  }
  if (
    blockedInCountry(
      repository,
      cartId,
      [
        Number(variantId),
        ...(resolved ?? customBlend).ingredients.map((ingredient) => ingredient.variantId),
      ],
      availabilityDependencies,
    )
  ) {
    return 'BLOCKED_IN_COUNTRY';
  }
  const persisted = resolved ? customBlendResolver!.toPersistedSpec(resolved) : customBlend;
  const changed = repository.replaceConfiguredLine(
    cartId,
    variantId,
    previousConfigKey,
    customBlend.configKey,
    JSON.stringify(persisted),
  );
  if (!changed) return 'VARIANT_NOT_IN_CART';
  repository.touch(cartId);
  const cart = getCart(repository, cartId, availabilityDependencies, customBlendResolver);
  if (!cart && customBlendResolver) {
    throw new Error('Custom Blend resolution failed after cart mutation.');
  }
  return cart ?? 'CART_NOT_FOUND';
}

function blockedInCountry(
  repository: CartRepository,
  cartId: string,
  variantIds: readonly number[],
  availabilityDependencies?: CartAvailabilityDependencies,
): boolean {
  const countryProfiles = availabilityDependencies?.countryProfiles;
  if (!countryProfiles) return false;
  return repository
    .listCountryVariantFacts(cartId, variantIds)
    .some(
      (fact) =>
        countryProfiles.isCategoryBlocked(fact.country, fact.product_category) ||
        countryProfiles.isProductBlocked(fact.country, fact.product_slug),
    );
}
