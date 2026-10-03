import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { Cart } from '@shop/contracts/cart';
import type {
  ReorderLineOutcome,
  ReorderResponse,
  ReorderSkipReason,
} from '@shop/contracts/reorder';
import { ReorderOutcomeList } from './ReorderOutcomeList';
import {
  BUY_AGAIN_FAILURE_KEY,
  BUY_AGAIN_FAILURE_MESSAGE,
  reorderSummaryMessage,
  SKIP_REASONS,
  skipReasonMessage,
} from './reorderPresentation';

const emptyCart: Cart = {
  id: '5e6f7a8b-1c2d-4e3f-8a9b-0c1d2e3f4a5b',
  items: [],
  subtotalCents: 0,
  discountableSubtotalCents: 0,
  blendingFeeTotalCents: 0,
  totalItems: 0,
};

function added(overrides: Partial<ReorderLineOutcome> = {}): ReorderLineOutcome {
  return {
    orderLineItemId: '31',
    productId: 'cement',
    productName: 'Portland cement',
    variantId: 601,
    sku: 'CEM-25',
    configKey: '',
    quantity: 4,
    status: 'added',
    reason: null,
    orderedUnitPriceCents: 900,
    currentUnitPriceCents: 900,
    priceChanged: false,
    ...overrides,
  };
}

function skipped(
  reason: ReorderSkipReason,
  overrides: Partial<ReorderLineOutcome> = {},
): ReorderLineOutcome {
  return {
    ...added(),
    orderLineItemId: '32',
    productId: 'lime',
    productName: 'Hydrated lime',
    quantity: 2,
    status: 'skipped',
    reason,
    currentUnitPriceCents: null,
    ...overrides,
  };
}

function response(outcomes: ReorderLineOutcome[]): ReorderResponse {
  return {
    cart: emptyCart,
    addedLineCount: outcomes.filter((outcome) => outcome.status === 'added').length,
    skippedLineCount: outcomes.filter((outcome) => outcome.status === 'skipped').length,
    outcomes,
  };
}

function renderList(state: Parameters<typeof ReorderOutcomeList>[0]['state']) {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ReorderOutcomeList orderId="12" state={state} />
    </MemoryRouter>,
  );
}

const regionName = 'Buy again result for order #12';

describe('ReorderOutcomeList', () => {
  it('keeps a named region mounted while idle with nothing rendered in it', () => {
    renderList({ kind: 'idle' });
    const region = screen.getByRole('status', { name: regionName });
    expect(region).toBeEmptyDOMElement();
  });

  it('reports the in-flight attempt in the status region', () => {
    renderList({ kind: 'pending' });
    expect(screen.getByRole('status', { name: regionName })).toHaveTextContent(
      'Adding this order to your cart…',
    );
  });

  it('shows a failed request as an error with the message the cart produced', () => {
    renderList({
      kind: 'error',
      message: 'That order is no longer available. Refresh your order history and try again.',
    });
    expect(screen.getByRole('status', { name: regionName })).toHaveTextContent(
      'That order is no longer available. Refresh your order history and try again.',
    );
  });

  it('renders a stable error key instead of a stale server message', () => {
    renderList({
      kind: 'error',
      message: 'legacy unlocalised error',
      messageKey: BUY_AGAIN_FAILURE_KEY,
    });

    const region = screen.getByRole('status', { name: regionName });
    expect(region).toHaveTextContent(BUY_AGAIN_FAILURE_MESSAGE);
    expect(region).not.toHaveTextContent('legacy unlocalised error');
  });

  it('names every skipped line with a plain-language cause and links to the cart', () => {
    renderList({
      kind: 'result',
      response: response([
        added(),
        skipped('VARIANT_RETIRED'),
        skipped('INSUFFICIENT_STOCK', { orderLineItemId: '33', productName: 'Sharp sand' }),
      ]),
    });

    const region = screen.getByRole('status', { name: regionName });
    expect(region).toHaveTextContent('1 item added to your cart. 2 items could not be added.');
    const skippedList = within(region).getByRole('list', {
      name: 'Items not added from order #12',
    });
    const entries = within(skippedList).getAllByRole('listitem');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveTextContent('Hydrated lime × 2');
    expect(entries[0]).toHaveTextContent('We no longer sell this item.');
    expect(entries[1]).toHaveTextContent('Sharp sand × 2');
    expect(entries[1]).toHaveTextContent('There is not enough in stock to repeat this amount.');
    expect(within(region).getByRole('link', { name: 'View cart' })).toHaveAttribute(
      'href',
      '/cart',
    );
  });

  it('shows old-to-new price for a line whose price moved', () => {
    renderList({
      kind: 'result',
      response: response([
        added({ priceChanged: true, orderedUnitPriceCents: 900, currentUnitPriceCents: 1050 }),
      ]),
    });

    const region = screen.getByRole('status', { name: regionName });
    const changes = within(region).getByRole('list', { name: 'Price changes on order #12' });
    expect(within(changes).getByRole('listitem')).toHaveTextContent(
      'Portland cement × 4 Price changed from $11.25 to $13.13 per item.',
    );
    expect(region).toHaveTextContent('1 item from this order was added to your cart.');
  });

  it('explains an all-skipped attempt instead of treating it as a failure', () => {
    renderList({
      kind: 'result',
      response: response([
        skipped('BELOW_MOQ'),
        skipped('BLEND_UNAVAILABLE', {
          orderLineItemId: '34',
          productName: 'House blend filler',
        }),
      ]),
    });

    const region = screen.getByRole('status', { name: regionName });
    expect(region).toHaveTextContent(
      'Nothing was added to your cart. 2 items from this order cannot be ordered right now.',
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View cart' })).not.toBeInTheDocument();
    expect(region).toHaveTextContent(
      'This amount is below the smallest amount we can deliver for this item.',
    );
    expect(region).toHaveTextContent('This custom blend cannot be made at the moment.');
  });
});

describe('reorder presentation copy', () => {
  it('gives every skip reason buyer copy free of internal codes and trade jargon', () => {
    // Derived from the copy record, which is keyed by the contract union: a reason added to the
    // contract fails typecheck there rather than slipping past this check.
    expect(SKIP_REASONS.length).toBeGreaterThan(0);
    for (const reason of SKIP_REASONS) {
      const message = skipReasonMessage(reason);
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toMatch(/MOQ|SKU|variant|_|\bblend unavailable\b/i);
    }
  });

  it('summarises each mix of counts in one sentence', () => {
    expect(reorderSummaryMessage(response([added()]))).toBe(
      '1 item from this order was added to your cart.',
    );
    expect(reorderSummaryMessage(response([added(), added({ orderLineItemId: '35' })]))).toBe(
      '2 items from this order were added to your cart.',
    );
    expect(reorderSummaryMessage(response([skipped('INVALID_QUANTITY')]))).toBe(
      'Nothing was added to your cart. 1 item from this order cannot be ordered right now.',
    );
    expect(reorderSummaryMessage(response([]))).toBe(
      'This order has nothing left to add to your cart.',
    );
  });
});
