import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedListDetail } from '@shop/contracts/saved-lists';
import { SavedListDetailPage } from './SavedListDetailPage';

const saved = vi.hoisted(() => ({ loadList: vi.fn(), updateItem: vi.fn(), removeItem: vi.fn() }));
const cart = vi.hoisted(() => ({ addSavedListToCart: vi.fn(), isActionPending: vi.fn() }));
vi.mock('@/hooks/useSavedLists', () => ({ useSavedLists: () => ({ ...saved, error: null }) }));
vi.mock('@/hooks/CartContext', () => ({
  useCartContext: () => ({ ...cart, isCartAvailable: true }),
}));
vi.mock('@/components/LoadingSpinner', () => ({ LoadingSpinner: () => <span>Loading</span> }));

const detail: SavedListDetail = {
  listId: '7',
  name: 'Site restock',
  isDefault: false,
  itemCount: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  items: [
    {
      itemId: '9',
      variantId: 1,
      sku: 'CEM-25',
      label: 'legacy server label',
      productId: 'cement',
      productName: 'Cement',
      quantity: 2,
      weightGrams: 25000,
      moqSacks: 4,
      unitPriceCents: 500,
      perTonneCents: 20000,
      availableToSell: true,
      backorderable: false,
      active: true,
    },
  ],
};
function renderPage() {
  return render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      initialEntries={['/lists/7']}
    >
      <Routes>
        <Route path="/lists/:listId" element={<SavedListDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}
describe('SavedListDetailPage', () => {
  beforeEach(() => {
    saved.loadList.mockReset().mockResolvedValue(detail);
    saved.updateItem
      .mockReset()
      .mockResolvedValue({ ...detail, items: [{ ...detail.items[0]!, quantity: 5 }] });
    saved.removeItem.mockReset().mockResolvedValue(true);
    cart.isActionPending.mockReset().mockReturnValue(false);
    cart.addSavedListToCart.mockReset().mockResolvedValue({
      cart: {
        id: '5e6f7a8b-1c2d-4e3f-8a9b-0c1d2e3f4a5b',
        items: [],
        subtotalCents: 0,
        discountableSubtotalCents: 0,
        blendingFeeTotalCents: 0,
        totalItems: 4,
      },
      addedLineCount: 1,
      skippedLineCount: 1,
      outcomes: [
        {
          itemId: '9',
          variantId: 1,
          sku: 'CEM-25',
          productId: 'cement',
          productName: 'Cement',
          savedQuantity: 2,
          submittedQuantity: 4,
          moqAdjusted: true,
          resolvedUnitPriceCents: 500,
          status: 'added',
          reason: null,
        },
        {
          itemId: '10',
          variantId: 2,
          sku: 'OLD',
          productId: 'old',
          productName: 'Old cement',
          savedQuantity: 1,
          submittedQuantity: null,
          moqAdjusted: false,
          resolvedUnitPriceCents: null,
          status: 'skipped',
          reason: 'VARIANT_RETIRED',
        },
      ],
    });
  });
  it('uses server facts, permits quantity editing/removal, and reports mixed cart results', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Site restock' });
    expect(screen.getByText('25 kg sack · CEM-25')).toBeInTheDocument();
    expect(screen.queryByText('legacy server label')).not.toBeInTheDocument();
    expect(screen.getByText(/\$250\.00 \/ tonne/)).toBeInTheDocument();
    expect(screen.getByText(/MOQ: 4 sacks/)).toBeInTheDocument();
    const quantity = screen.getByRole('spinbutton', { name: 'Quantity for Cement' });
    await user.clear(quantity);
    await user.type(quantity, '5');
    await user.tab();
    await waitFor(() => expect(saved.updateItem).toHaveBeenCalledWith('7', '9', { quantity: 5 }));
    await user.click(screen.getByRole('button', { name: 'Add to cart' }));
    await screen.findByText('1 item added to your cart. 1 item could not be added.');
    expect(screen.getByText('We no longer sell this item.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(saved.removeItem).toHaveBeenCalledWith('7', '9'));
  });
});
