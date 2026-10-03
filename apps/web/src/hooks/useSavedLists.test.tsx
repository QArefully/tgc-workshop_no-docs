import { act, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SavedListsProvider, useSavedListsContext } from './SavedListsContext';
import { ApiError } from '@/api/client';

const auth = vi.fn<() => { user: { id: string } | null }>();
vi.mock('./AuthContext', () => ({ useAuth: () => auth() }));
vi.mock('@/api/savedLists', () => ({
  getSavedLists: vi.fn(),
  getSavedList: vi.fn(),
  createSavedList: vi.fn(),
  addSavedListItem: vi.fn(),
  removeSavedListItem: vi.fn(),
}));
import * as api from '@/api/savedLists';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const summary = {
  listId: '1',
  name: 'Favourites',
  isDefault: true,
  itemCount: 0,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};
const detail = (variantIds: number[] = []) => ({
  ...summary,
  itemCount: variantIds.length,
  items: variantIds.map((variantId) => ({
    itemId: String(variantId),
    variantId,
    sku: `MAT-${variantId}`,
    label: '25kg sack',
    productId: `product-${variantId}`,
    productName: 'Material',
    quantity: 1,
    weightGrams: 25000,
    moqSacks: 1,
    unitPriceCents: 100,
    perTonneCents: 4000,
    availableToSell: true,
    backorderable: false,
    active: true,
  })),
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <SavedListsProvider>{children}</SavedListsProvider>
);

describe('useSavedLists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockReturnValue({ user: null });
  });

  it('keeps anonymous state empty without requesting saved lists', () => {
    const { result } = renderHook(() => useSavedListsContext(), { wrapper });
    expect(result.current.savedLists).toEqual([]);
    expect(api.getSavedLists).not.toHaveBeenCalled();
  });

  it('loads the shared default list once for an authenticated buyer', async () => {
    auth.mockReturnValue({ user: { id: '1' } });
    vi.mocked(api.getSavedLists).mockResolvedValue([
      {
        listId: '1',
        name: 'Favourites',
        isDefault: true,
        itemCount: 0,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    ]);
    vi.mocked(api.getSavedList).mockResolvedValue({
      listId: '1',
      name: 'Favourites',
      isDefault: true,
      itemCount: 0,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      items: [],
    });
    const { result } = renderHook(() => useSavedListsContext(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(api.getSavedLists).toHaveBeenCalledOnce();
    expect(api.getSavedList).toHaveBeenCalledWith('1');
  });

  it('shares one initial fetch between multiple consumers', async () => {
    auth.mockReturnValue({ user: { id: '1' } });
    vi.mocked(api.getSavedLists).mockResolvedValue([summary]);
    vi.mocked(api.getSavedList).mockResolvedValue(detail());
    const { result } = renderHook(() => [useSavedListsContext(), useSavedListsContext()] as const, {
      wrapper,
    });
    await waitFor(() => expect(result.current[0].loading).toBe(false));
    expect(api.getSavedLists).toHaveBeenCalledOnce();
    expect(result.current[0].lists).toBe(result.current[1].lists);
  });

  it('optimistically toggles then rolls back a failed default save', async () => {
    auth.mockReturnValue({ user: { id: '1' } });
    vi.mocked(api.getSavedLists).mockResolvedValue([summary]);
    vi.mocked(api.getSavedList).mockResolvedValue(detail());
    vi.mocked(api.addSavedListItem).mockRejectedValue(new Error('Unavailable'));
    const { result } = renderHook(() => useSavedListsContext(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    let action!: Promise<boolean>;
    act(() => {
      action = result.current.toggleDefaultSave(101);
    });
    expect(result.current.savedVariantIds.has(101)).toBe(true);
    await act(async () => {
      await expect(action).resolves.toBe(false);
    });
    expect(result.current.savedVariantIds.has(101)).toBe(false);
    expect(result.current.error).toBe('Unable to update this saved item. Please try again.');
  });

  it.each([
    ['NAME_TAKEN', 'A saved list with this name already exists. Choose a different name.'],
    [
      'LIST_LIMIT_REACHED',
      'You have reached the saved-list limit. Remove a list before creating another.',
    ],
  ])('maps %s create failures to buyer-actionable copy', async (code, message) => {
    auth.mockReturnValue({ user: { id: '1' } });
    vi.mocked(api.getSavedLists).mockResolvedValue([]);
    const error = new ApiError('Saved list request failed', 409, {
      error: 'Saved list request failed',
    });
    (error.response as { code?: string }).code = code;
    vi.mocked(api.createSavedList).mockRejectedValue(error);
    const { result } = renderHook(() => useSavedListsContext(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(result.current.createList({ name: 'Depot restock' })).resolves.toBe(false);
    });
    expect(result.current.error).toBe(message);
  });

  it('serializes rapid saves so complete later state cannot be discarded', async () => {
    auth.mockReturnValue({ user: { id: '1' } });
    const first = deferred<ReturnType<typeof detail>>();
    const second = deferred<ReturnType<typeof detail>>();
    vi.mocked(api.getSavedLists).mockResolvedValue([summary]);
    vi.mocked(api.getSavedList).mockResolvedValue(detail());
    vi.mocked(api.addSavedListItem)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useSavedListsContext(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    let one!: Promise<boolean>;
    let two!: Promise<boolean>;
    act(() => {
      one = result.current.toggleDefaultSave(101);
      two = result.current.toggleDefaultSave(102);
    });
    await waitFor(() => expect(api.addSavedListItem).toHaveBeenCalledOnce());
    await act(async () => {
      first.resolve(detail([101]));
      await first.promise;
    });
    await waitFor(() => expect(api.addSavedListItem).toHaveBeenCalledTimes(2));
    await act(async () => {
      second.resolve(detail([101, 102]));
      await second.promise;
    });
    await expect(one).resolves.toBe(true);
    await expect(two).resolves.toBe(true);
    expect(result.current.savedVariantIds).toEqual(new Set([101, 102]));
  });
});
