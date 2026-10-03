import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { SavedListAddToCartResponse } from '@shop/contracts/saved-lists';
import { SavedListOutcomeList } from './SavedListOutcomeList';
import {
  SAVED_LIST_ADD_FAILURE_KEY,
  SAVED_LIST_ADD_FAILURE_MESSAGE,
} from './savedListsPresentation';

const response: SavedListAddToCartResponse = {
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
      itemId: '1',
      variantId: 1,
      sku: 'CEM-25',
      productId: 'cement',
      productName: 'Cement',
      savedQuantity: 1,
      submittedQuantity: 4,
      moqAdjusted: true,
      resolvedUnitPriceCents: 500,
      status: 'added',
      reason: null,
    },
    {
      itemId: '2',
      variantId: 2,
      sku: 'OLD-25',
      productId: 'old',
      productName: 'Old cement',
      savedQuantity: 2,
      submittedQuantity: null,
      moqAdjusted: false,
      resolvedUnitPriceCents: null,
      status: 'skipped',
      reason: 'VARIANT_RETIRED',
    },
  ],
};
function renderList(state: Parameters<typeof SavedListOutcomeList>[0]['state']) {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <SavedListOutcomeList state={state} />
    </MemoryRouter>,
  );
}
describe('SavedListOutcomeList', () => {
  it('keeps an idle polite region empty', () => {
    renderList({ kind: 'idle' });
    const region = screen.getByRole('status', { name: 'Saved list cart result' });
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toBeEmptyDOMElement();
  });
  it('separates adjusted and skipped results and links only after additions', () => {
    renderList({ kind: 'result', response });
    const region = screen.getByRole('status');
    expect(
      within(region).getByRole('list', { name: 'Amounts adjusted for saved list' }),
    ).toHaveTextContent('increased from 1 to 4');
    expect(
      within(region).getByRole('list', { name: 'Items not added from saved list' }),
    ).toHaveTextContent('We no longer sell this item.');
    expect(within(region).getByRole('link', { name: 'View cart' })).toHaveAttribute(
      'href',
      '/cart',
    );
  });
  it('reports pending and does not link an all-skipped result', () => {
    const { rerender } = renderList({ kind: 'pending' });
    expect(screen.getByRole('status')).toHaveTextContent(/Adding to cart/);
    rerender(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SavedListOutcomeList
          state={{
            kind: 'result',
            response: {
              ...response,
              addedLineCount: 0,
              skippedLineCount: 1,
              outcomes: [response.outcomes[1]!],
            },
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link', { name: 'View cart' })).not.toBeInTheDocument();
  });

  it('renders a stable error key instead of a stale server message', () => {
    renderList({
      kind: 'error',
      message: 'legacy unlocalised error',
      messageKey: SAVED_LIST_ADD_FAILURE_KEY,
    });

    const region = screen.getByRole('status', { name: 'Saved list cart result' });
    expect(region).toHaveTextContent(SAVED_LIST_ADD_FAILURE_MESSAGE);
    expect(region).not.toHaveTextContent('legacy unlocalised error');
  });
});
