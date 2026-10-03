import {
  AddSavedListToCartBody,
  AddSavedListItemBody,
  CreateSavedListBody,
  RenameSavedListBody,
  SaveCartAsListBody,
  SaveOrderAsListBody,
  SavedListAddToCartResponse,
  SavedListDetail,
  SavedListsResponse,
  UpdateSavedListItemBody,
  type AddSavedListToCartBody as AddSavedListToCartPayload,
  type AddSavedListItemBody as AddSavedListItemPayload,
  type CreateSavedListBody as CreateSavedListPayload,
  type RenameSavedListBody as RenameSavedListPayload,
  type SaveCartAsListBody as SaveCartAsListPayload,
  type SaveOrderAsListBody as SaveOrderAsListPayload,
  type UpdateSavedListItemBody as UpdateSavedListItemPayload,
  type SavedListAddToCartResponse as SavedListAddToCartResult,
  type SavedListDetail as SavedListDetailResult,
  type SavedListsResponse as SavedListsResult,
} from '@shop/contracts/saved-lists';
import { SuccessResponse } from '@shop/contracts/common';
import { apiFetch } from './client';

const pathForList = (listId: string) => `/api/saved-lists/${encodeURIComponent(listId)}`;
const pathForItem = (listId: string, itemId: string) =>
  `${pathForList(listId)}/items/${encodeURIComponent(itemId)}`;

export const getSavedLists = (): Promise<SavedListsResult> =>
  apiFetch(SavedListsResponse, '/api/saved-lists');
export const getSavedList = (listId: string): Promise<SavedListDetailResult> =>
  apiFetch(SavedListDetail, pathForList(listId));
export const createSavedList = (body: CreateSavedListPayload): Promise<SavedListDetailResult> =>
  apiFetch(SavedListDetail, '/api/saved-lists', {
    method: 'POST',
    body: JSON.stringify(body satisfies CreateSavedListBody),
  });
export const renameSavedList = (
  listId: string,
  body: RenameSavedListPayload,
): Promise<SavedListDetailResult> =>
  apiFetch(SavedListDetail, pathForList(listId), {
    method: 'PATCH',
    body: JSON.stringify(body satisfies RenameSavedListBody),
  });
export const deleteSavedList = (listId: string): Promise<void> =>
  apiFetch(SuccessResponse, pathForList(listId), { method: 'DELETE' }).then(() => undefined);
export const addSavedListItem = (
  listId: string,
  body: AddSavedListItemPayload,
): Promise<SavedListDetailResult> =>
  apiFetch(SavedListDetail, `${pathForList(listId)}/items`, {
    method: 'POST',
    body: JSON.stringify(body satisfies AddSavedListItemBody),
  });
export const updateSavedListItem = (
  listId: string,
  itemId: string,
  body: UpdateSavedListItemPayload,
): Promise<SavedListDetailResult> =>
  apiFetch(SavedListDetail, pathForItem(listId, itemId), {
    method: 'PATCH',
    body: JSON.stringify(body satisfies UpdateSavedListItemBody),
  });
export const removeSavedListItem = (listId: string, itemId: string): Promise<void> =>
  apiFetch(SuccessResponse, pathForItem(listId, itemId), { method: 'DELETE' }).then(
    () => undefined,
  );
export const addSavedListToCart = (
  listId: string,
  body: AddSavedListToCartPayload,
): Promise<SavedListAddToCartResult> =>
  apiFetch(SavedListAddToCartResponse, `${pathForList(listId)}/add-to-cart`, {
    method: 'POST',
    body: JSON.stringify(body satisfies AddSavedListToCartBody),
  });
export const saveCartAsSavedList = (body: SaveCartAsListPayload): Promise<SavedListDetailResult> =>
  apiFetch(SavedListDetail, '/api/saved-lists/from-cart', {
    method: 'POST',
    body: JSON.stringify(body satisfies SaveCartAsListBody),
  });
export const saveOrderAsSavedList = (
  orderId: string,
  body: SaveOrderAsListPayload,
): Promise<SavedListDetailResult> =>
  apiFetch(SavedListDetail, `/api/saved-lists/from-order/${encodeURIComponent(orderId)}`, {
    method: 'POST',
    body: JSON.stringify(body satisfies SaveOrderAsListBody),
  });
