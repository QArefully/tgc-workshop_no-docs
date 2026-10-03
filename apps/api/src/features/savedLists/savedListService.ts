import type { Cart } from '@shop/contracts/cart';
import type { OrderLineItem } from '@shop/contracts/orders';
import type {
  SavedListDetail,
  SavedListItem,
  SavedListLineOutcome,
  SavedListSummary,
} from '@shop/contracts/saved-lists';
import type { UnitOfWork } from '../../db/unitOfWork.js';
import type { AuditContext } from '../audit/auditEvent.js';
import type { AuditWriter, Clock } from '../audit/auditService.js';
import type { CartService } from '../cart/cartService.js';
import type { VariantRow } from '../catalog/productRepository.js';
import type { OrderService } from '../orders/orderService.js';
import type { InventoryService } from '../inventory/inventoryService.js';
import { resolveClearance } from '../pricing/clearanceRules.js';
import { perTonneCents, resolveUnitPriceCents } from '../pricing/pricingRules.js';
import { savedListError, savedListOk, type SavedListResult } from './savedListErrors.js';
import {
  createSavedListRepository,
  type SavedListItemRow,
  type SavedListRepository,
  type SavedListRow,
} from './savedListRepository.js';
import {
  SAVED_LIST_MAX_ITEMS,
  SAVED_LIST_MAX_PER_USER,
  assembleSavedListCartOutcomes,
  buildSavedListCartPlan,
  countSavedListOutcomes,
  normalizeSavedListName,
  safeSavedQuantity,
} from './savedListRules.js';

export interface SavedListVariantReader {
  findVariantById(variantId: number): VariantRow | undefined;
  findVariantsByIds(variantIds: readonly number[]): VariantRow[];
}
export interface SavedListDependencies {
  repository: SavedListRepository;
  variants: SavedListVariantReader;
  inventory: Pick<InventoryService, 'availableToSell'>;
  carts: Pick<CartService, 'get' | 'addMany'>;
  orders: Pick<OrderService, 'getOwned'>;
  unitOfWork: UnitOfWork;
  audit: AuditWriter;
  clock: Clock;
}
export interface SavedListService {
  list(userId: number): SavedListSummary[];
  get(userId: number, listId: number): SavedListResult<SavedListDetail>;
  getOrCreateDefault(userId: number, context: AuditContext): SavedListResult<SavedListDetail>;
  create(userId: number, name: string, context: AuditContext): SavedListResult<SavedListDetail>;
  rename(
    userId: number,
    listId: number,
    name: string,
    context: AuditContext,
  ): SavedListResult<SavedListDetail>;
  delete(userId: number, listId: number, context: AuditContext): SavedListResult<null>;
  addItem(
    userId: number,
    listId: number,
    variantId: number,
    quantity: number,
    context: AuditContext,
  ): SavedListResult<SavedListDetail>;
  updateItem(
    userId: number,
    listId: number,
    itemId: number,
    quantity: number,
    context: AuditContext,
  ): SavedListResult<SavedListDetail>;
  removeItem(
    userId: number,
    listId: number,
    itemId: number,
    context: AuditContext,
  ): SavedListResult<null>;
  addToCart(
    userId: number,
    listId: number,
    cartId: string,
    context: AuditContext,
  ): SavedListResult<{
    cart: Cart;
    addedLineCount: number;
    skippedLineCount: number;
    outcomes: SavedListLineOutcome[];
  }>;
  createFromCart(
    userId: number,
    cartId: string,
    name: string,
    context: AuditContext,
  ): SavedListResult<SavedListDetail>;
  createFromOrder(
    userId: number,
    orderId: number,
    name: string,
    context: AuditContext,
  ): SavedListResult<SavedListDetail>;
}

function summary(row: SavedListRow, itemCount = row.item_count ?? 0): SavedListSummary {
  return {
    listId: String(row.id),
    name: row.name,
    isDefault: row.is_default === 1,
    itemCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function item(row: SavedListItemRow, availableToSell: number, now: Date): SavedListItem {
  const live = row.active === 1;
  const clearance = resolveClearance({
    priceCents: row.price_cents,
    clearancePriceCents: row.clearance_price_cents,
    clearanceStartsAt: row.clearance_starts_at,
    clearanceEndsAt: row.clearance_ends_at,
    weightGrams: row.weight_grams,
    now,
  });
  const basePriceCents = clearance.clearance?.priceCents ?? clearance.basePriceCents;
  const unitPriceCents = live
    ? resolveUnitPriceCents(basePriceCents, row.quantity, row.weight_grams)
    : null;
  return {
    itemId: String(row.id),
    variantId: row.variant_id,
    sku: row.sku,
    label: row.label,
    productId: String(row.product_id),
    productName: row.product_name,
    quantity: row.quantity,
    weightGrams: row.weight_grams,
    moqSacks: row.moq_sacks,
    unitPriceCents,
    perTonneCents: unitPriceCents === null ? null : perTonneCents(unitPriceCents, row.weight_grams),
    availableToSell: live && (availableToSell > 0 || row.backorderable === 1),
    backorderable: row.backorderable === 1,
    active: live,
  };
}

export function createSavedListService(dependencies: SavedListDependencies): SavedListService {
  const now = () => dependencies.clock.now().toISOString();
  const detail = (userId: number, listId: number): SavedListDetail | null => {
    const row = dependencies.repository.findOwned(userId, listId);
    if (!row) return null;
    const rows = dependencies.repository.listItems(userId, listId);
    const at = dependencies.clock.now();
    const availability = new Map(
      dependencies.inventory
        .availableToSell(
          rows.map((savedItem) => savedItem.variant_id),
          at.toISOString(),
        )
        .map((entry) => [entry.variantId, entry.availableToSell]),
    );
    return {
      ...summary(row, rows.length),
      items: rows.map((savedItem) =>
        item(savedItem, availability.get(savedItem.variant_id) ?? 0, at),
      ),
    };
  };
  const validName = (name: string) => normalizeSavedListName(name);
  const nameTaken = (userId: number, name: string, excluding?: number) => {
    const found = dependencies.repository.findOwnedByName(userId, name);
    return found !== undefined && found.id !== excluding;
  };
  const create = (
    userId: number,
    nameInput: string,
    context: AuditContext,
    items: readonly { variantId: number; quantity: number }[] = [],
  ): SavedListResult<SavedListDetail> =>
    dependencies.unitOfWork.run(() => {
      const name = validName(nameInput);
      if (!name) return savedListError('NAME_INVALID');
      if (dependencies.repository.countOwned(userId) >= SAVED_LIST_MAX_PER_USER)
        return savedListError('LIST_LIMIT_REACHED');
      if (nameTaken(userId, name)) return savedListError('NAME_TAKEN');
      // Cart rows are unique by variant/config but historic orders can contain repeated plain lines.
      // Coalesce only while the sum remains safe; an unusable row is excluded like an unresolved one.
      const quantities = new Map<number, number>();
      for (const source of items) {
        if (
          !safeSavedQuantity(source.quantity) ||
          !dependencies.variants.findVariantById(source.variantId)
        )
          continue;
        const next = (quantities.get(source.variantId) ?? 0) + source.quantity;
        if (Number.isSafeInteger(next)) quantities.set(source.variantId, next);
      }
      if (quantities.size > SAVED_LIST_MAX_ITEMS) return savedListError('ITEM_LIMIT_REACHED');
      const at = now();
      const row = dependencies.repository.insertList({ userId, name, isDefault: false, now: at });
      for (const [variantId, quantity] of quantities)
        dependencies.repository.insertItem({ listId: row.id, variantId, quantity, now: at });
      dependencies.audit.append({
        action: 'saved_list.created',
        savedListId: row.id,
        name,
        context,
      });
      return savedListOk(detail(userId, row.id)!);
    });
  return {
    list(userId) {
      return dependencies.repository.list(userId).map(summary);
    },
    get(userId, listId) {
      const value = detail(userId, listId);
      return value ? savedListOk(value) : savedListError('LIST_NOT_FOUND');
    },
    getOrCreateDefault(userId, context) {
      return dependencies.unitOfWork.run(() => {
        let row = dependencies.repository.findDefault(userId);
        if (!row) {
          if (dependencies.repository.countOwned(userId) >= SAVED_LIST_MAX_PER_USER)
            return savedListError<SavedListDetail>('LIST_LIMIT_REACHED');
          if (nameTaken(userId, 'Favourites')) return savedListError<SavedListDetail>('NAME_TAKEN');
          const at = now();
          row = dependencies.repository.insertList({
            userId,
            name: 'Favourites',
            isDefault: true,
            now: at,
          });
          dependencies.audit.append({
            action: 'saved_list.created',
            savedListId: row.id,
            name: row.name,
            context,
          });
        }
        return savedListOk(detail(userId, row.id)!);
      });
    },
    create(userId, name, context) {
      return create(userId, name, context);
    },
    rename(userId, listId, nameInput, context) {
      return dependencies.unitOfWork.run(() => {
        const row = dependencies.repository.findOwned(userId, listId);
        if (!row) return savedListError<SavedListDetail>('LIST_NOT_FOUND');
        const name = validName(nameInput);
        if (!name) return savedListError<SavedListDetail>('NAME_INVALID');
        if (nameTaken(userId, name, listId)) return savedListError<SavedListDetail>('NAME_TAKEN');
        dependencies.repository.updateListName(userId, listId, name, now());
        dependencies.audit.append({
          action: 'saved_list.renamed',
          savedListId: listId,
          name,
          context,
        });
        return savedListOk(detail(userId, listId)!);
      });
    },
    delete(userId, listId, context) {
      return dependencies.unitOfWork.run(() => {
        const row = dependencies.repository.findOwned(userId, listId);
        if (!row) return savedListError<null>('LIST_NOT_FOUND');
        if (row.is_default === 1) return savedListError<null>('DEFAULT_LIST_IMMUTABLE');
        dependencies.repository.deleteList(userId, listId);
        dependencies.audit.append({ action: 'saved_list.deleted', savedListId: listId, context });
        return savedListOk(null);
      });
    },
    addItem(userId, listId, variantId, quantity, context) {
      return dependencies.unitOfWork.run(() => {
        if (!dependencies.repository.findOwned(userId, listId))
          return savedListError<SavedListDetail>('LIST_NOT_FOUND');
        if (!safeSavedQuantity(quantity))
          return savedListError<SavedListDetail>('VARIANT_NOT_FOUND');
        if (!dependencies.variants.findVariantById(variantId))
          return savedListError<SavedListDetail>('VARIANT_NOT_FOUND');
        const at = now();
        const existing = dependencies.repository.findItemByVariant(listId, variantId);
        if (existing) {
          dependencies.repository.updateItemByVariant(listId, variantId, quantity, at);
          dependencies.audit.append({
            action: 'saved_list.item_updated',
            savedListId: listId,
            itemId: existing.id,
            quantity,
            context,
          });
        } else {
          if (dependencies.repository.countItems(listId) >= SAVED_LIST_MAX_ITEMS)
            return savedListError<SavedListDetail>('ITEM_LIMIT_REACHED');
          dependencies.repository.insertItem({ listId, variantId, quantity, now: at });
          dependencies.audit.append({
            action: 'saved_list.item_added',
            savedListId: listId,
            variantId,
            quantity,
            context,
          });
        }
        return savedListOk(detail(userId, listId)!);
      });
    },
    updateItem(userId, listId, itemId, quantity, context) {
      return dependencies.unitOfWork.run(() => {
        if (!dependencies.repository.findOwned(userId, listId))
          return savedListError<SavedListDetail>('LIST_NOT_FOUND');
        if (!safeSavedQuantity(quantity)) return savedListError<SavedListDetail>('ITEM_NOT_FOUND');
        if (!dependencies.repository.findItem(userId, listId, itemId))
          return savedListError<SavedListDetail>('ITEM_NOT_FOUND');
        dependencies.repository.updateItem(listId, itemId, quantity, now());
        dependencies.audit.append({
          action: 'saved_list.item_updated',
          savedListId: listId,
          itemId,
          quantity,
          context,
        });
        return savedListOk(detail(userId, listId)!);
      });
    },
    removeItem(userId, listId, itemId, context) {
      return dependencies.unitOfWork.run(() => {
        if (!dependencies.repository.findOwned(userId, listId))
          return savedListError<null>('LIST_NOT_FOUND');
        if (!dependencies.repository.findItem(userId, listId, itemId))
          return savedListError<null>('ITEM_NOT_FOUND');
        dependencies.repository.deleteItem(listId, itemId);
        dependencies.audit.append({
          action: 'saved_list.item_removed',
          savedListId: listId,
          itemId,
          context,
        });
        return savedListOk(null);
      });
    },
    addToCart(userId, listId, cartId, context) {
      return dependencies.unitOfWork.run(() => {
        const list = dependencies.repository.findOwned(userId, listId);
        if (!list) return savedListError('LIST_NOT_FOUND');
        const rows = dependencies.repository.listItems(userId, listId);
        const variants = dependencies.variants.findVariantsByIds(rows.map((row) => row.variant_id));
        const byId = new Map(variants.map((variant) => [variant.id, variant]));
        const sources = rows.map((row) => ({
          itemId: row.id,
          variantId: row.variant_id,
          sku: row.sku,
          productId: String(row.product_id),
          productName: row.product_name,
          quantity: row.quantity,
          variant: byId.get(row.variant_id),
        }));
        const plan = buildSavedListCartPlan(sources);
        const cartResult = dependencies.carts.addMany(cartId, plan.requests, context);
        if (cartResult === 'CART_NOT_FOUND' || cartResult === 'CART_RESERVED')
          return savedListError(cartResult);
        const outcomes = assembleSavedListCartOutcomes(sources, plan, cartResult.outcomes);
        const counts = countSavedListOutcomes(outcomes);
        dependencies.audit.append({
          action: 'cart.saved_list_added',
          cartId,
          savedListId: listId,
          itemCount: rows.length,
          ...counts,
          context,
        });
        return savedListOk({ cart: cartResult.cart, ...counts, outcomes });
      });
    },
    createFromCart(userId, cartId, name, context) {
      const cart = dependencies.carts.get(cartId);
      if (!cart) return savedListError('CART_NOT_FOUND');
      const stock = cart.items
        .filter((line) => line.configKey === '' && !line.customBlend && line.variantSnap)
        .map((line) => ({ variantId: line.variantSnap!.variantId, quantity: line.quantity }));
      if (!stock.length) return savedListError('CART_EMPTY');
      return create(userId, name, context, stock);
    },
    createFromOrder(userId, orderId, name, context) {
      const order = dependencies.orders.getOwned(orderId, userId);
      if (!order) return savedListError('ORDER_NOT_FOUND');
      const stock = order.items
        .filter(
          (line: OrderLineItem) =>
            !line.customBlend &&
            line.variantSnapshot?.variantId &&
            safeSavedQuantity(line.quantity),
        )
        .map((line) => ({ variantId: line.variantSnapshot!.variantId, quantity: line.quantity }));
      return create(userId, name, context, stock);
    },
  };
}

export { createSavedListRepository };
