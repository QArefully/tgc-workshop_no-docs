import type Database from 'better-sqlite3';

export interface SavedListRow {
  id: number;
  user_id: number;
  name: string;
  is_default: number;
  created_at: string;
  updated_at: string;
  item_count?: number;
}
export interface SavedListItemRow {
  id: number;
  saved_list_id: number;
  variant_id: number;
  quantity: number;
  created_at: string;
  updated_at: string;
  sku: string;
  label: string;
  product_id: number;
  product_name: string;
  weight_grams: number;
  moq_sacks: number;
  price_cents: number;
  clearance_price_cents: number | null;
  clearance_starts_at: string | null;
  clearance_ends_at: string | null;
  stock_count: number;
  backorderable: number;
  active: number;
}
export interface SavedListRepository {
  list(userId: number): SavedListRow[];
  findOwned(userId: number, listId: number): SavedListRow | undefined;
  findOwnedByName(userId: number, name: string): SavedListRow | undefined;
  findDefault(userId: number): SavedListRow | undefined;
  countOwned(userId: number): number;
  listItems(userId: number, listId: number): SavedListItemRow[];
  findItem(userId: number, listId: number, itemId: number): SavedListItemRow | undefined;
  countItems(listId: number): number;
  insertList(input: {
    userId: number;
    name: string;
    isDefault: boolean;
    now: string;
  }): SavedListRow;
  updateListName(userId: number, listId: number, name: string, now: string): void;
  deleteList(userId: number, listId: number): void;
  insertItem(input: {
    listId: number;
    variantId: number;
    quantity: number;
    now: string;
  }): SavedListItemRow;
  findItemByVariant(listId: number, variantId: number): SavedListItemRow | undefined;
  updateItem(listId: number, itemId: number, quantity: number, now: string): void;
  updateItemByVariant(listId: number, variantId: number, quantity: number, now: string): void;
  deleteItem(listId: number, itemId: number): void;
}

const LIST_COLUMNS = 'id, user_id, name, is_default, created_at, updated_at';
const LIST_COLUMNS_WITH_ALIAS = 'l.id, l.user_id, l.name, l.is_default, l.created_at, l.updated_at';
const ITEM_COLUMNS = `i.id, i.saved_list_id, i.variant_id, i.quantity, i.created_at, i.updated_at,
  v.sku, v.label, v.weight_grams, v.moq_sacks, v.price_cents, v.clearance_price_cents, v.clearance_starts_at, v.clearance_ends_at,
  v.stock_count, v.backorderable, v.active,
  p.id AS product_id, p.name AS product_name`;

export function createSavedListRepository(db: Database.Database): SavedListRepository {
  const itemSelect = `SELECT ${ITEM_COLUMNS} FROM saved_list_items i JOIN saved_lists l ON l.id = i.saved_list_id JOIN product_variants v ON v.id = i.variant_id JOIN products p ON p.id = v.product_id`;
  return {
    list(userId) {
      return db
        .prepare(
          `SELECT ${LIST_COLUMNS_WITH_ALIAS}, COUNT(i.id) AS item_count FROM saved_lists l LEFT JOIN saved_list_items i ON i.saved_list_id = l.id WHERE l.user_id = ? GROUP BY l.id ORDER BY l.is_default DESC, l.name COLLATE NOCASE, l.id`,
        )
        .all(userId) as SavedListRow[];
    },
    findOwned(userId, listId) {
      return db
        .prepare(`SELECT ${LIST_COLUMNS} FROM saved_lists WHERE id = ? AND user_id = ?`)
        .get(listId, userId) as SavedListRow | undefined;
    },
    findOwnedByName(userId, name) {
      return db
        .prepare(
          `SELECT ${LIST_COLUMNS} FROM saved_lists WHERE user_id = ? AND name = ? COLLATE NOCASE`,
        )
        .get(userId, name) as SavedListRow | undefined;
    },
    findDefault(userId) {
      return db
        .prepare(`SELECT ${LIST_COLUMNS} FROM saved_lists WHERE user_id = ? AND is_default = 1`)
        .get(userId) as SavedListRow | undefined;
    },
    countOwned(userId) {
      return (
        db.prepare('SELECT COUNT(*) AS total FROM saved_lists WHERE user_id = ?').get(userId) as {
          total: number;
        }
      ).total;
    },
    listItems(userId, listId) {
      return db
        .prepare(
          `${itemSelect} WHERE l.user_id = ? AND i.saved_list_id = ? ORDER BY i.created_at DESC, i.id DESC`,
        )
        .all(userId, listId) as SavedListItemRow[];
    },
    findItem(userId, listId, itemId) {
      return db
        .prepare(`${itemSelect} WHERE l.user_id = ? AND i.saved_list_id = ? AND i.id = ?`)
        .get(userId, listId, itemId) as SavedListItemRow | undefined;
    },
    countItems(listId) {
      return (
        db
          .prepare('SELECT COUNT(*) AS total FROM saved_list_items WHERE saved_list_id = ?')
          .get(listId) as { total: number }
      ).total;
    },
    insertList({ userId, name, isDefault, now }) {
      const result = db
        .prepare(
          'INSERT INTO saved_lists (user_id, name, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(userId, name, isDefault ? 1 : 0, now, now);
      return db
        .prepare(`SELECT ${LIST_COLUMNS} FROM saved_lists WHERE id = ?`)
        .get(Number(result.lastInsertRowid)) as SavedListRow;
    },
    updateListName(userId, listId, name, now) {
      db.prepare(
        'UPDATE saved_lists SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?',
      ).run(name, now, listId, userId);
    },
    deleteList(userId, listId) {
      db.prepare('DELETE FROM saved_lists WHERE id = ? AND user_id = ?').run(listId, userId);
    },
    insertItem({ listId, variantId, quantity, now }) {
      const result = db
        .prepare(
          'INSERT INTO saved_list_items (saved_list_id, variant_id, quantity, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(listId, variantId, quantity, now, now);
      return db
        .prepare(`${itemSelect} WHERE i.id = ?`)
        .get(Number(result.lastInsertRowid)) as SavedListItemRow;
    },
    findItemByVariant(listId, variantId) {
      return db
        .prepare(`${itemSelect} WHERE i.saved_list_id = ? AND i.variant_id = ?`)
        .get(listId, variantId) as SavedListItemRow | undefined;
    },
    updateItem(listId, itemId, quantity, now) {
      db.prepare(
        'UPDATE saved_list_items SET quantity = ?, updated_at = ? WHERE id = ? AND saved_list_id = ?',
      ).run(quantity, now, itemId, listId);
    },
    updateItemByVariant(listId, variantId, quantity, now) {
      db.prepare(
        'UPDATE saved_list_items SET quantity = ?, updated_at = ? WHERE saved_list_id = ? AND variant_id = ?',
      ).run(quantity, now, listId, variantId);
    },
    deleteItem(listId, itemId) {
      db.prepare('DELETE FROM saved_list_items WHERE id = ? AND saved_list_id = ?').run(
        itemId,
        listId,
      );
    },
  };
}
