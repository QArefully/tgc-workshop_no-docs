import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { Cart } from '@shop/contracts/cart';
import type {
  QuickOrderLineOutcome,
  QuickOrderResponse,
  QuickOrderSkipReason,
} from '@shop/contracts/quick-order';
import { QuickOrderOutcomeList } from './QuickOrderOutcomeList';
import {
  adjustedOutcomes,
  QUICK_ORDER_FAILURE_KEY,
  QUICK_ORDER_FAILURE_MESSAGE,
  quickOrderSummaryMessage,
  SKIP_REASONS,
  skipReasonMessage,
  skippedOutcomes,
} from './quickOrderPresentation';

const emptyCart: Cart = {
  id: '5e6f7a8b-1c2d-4e3f-8a9b-0c1d2e3f4a5b',
  items: [],
  subtotalCents: 0,
  discountableSubtotalCents: 0,
  blendingFeeTotalCents: 0,
  totalItems: 0,
};

function added(overrides: Partial<QuickOrderLineOutcome> = {}): QuickOrderLineOutcome {
  return {
    lineNumber: 1,
    rawLine: 'CEMENT-25, 4',
    sku: 'CEMENT-25',
    requestedQuantity: 4,
    submittedQuantity: 4,
    moqAdjusted: false,
    duplicateSku: false,
    variantId: 601,
    productId: 'cement',
    productName: 'Portland cement',
    resolvedUnitPriceCents: 900,
    status: 'added',
    reason: null,
    ...overrides,
  };
}

function skipped(
  reason: QuickOrderSkipReason,
  overrides: Partial<QuickOrderLineOutcome> = {},
): QuickOrderLineOutcome {
  return {
    ...added(),
    lineNumber: 2,
    rawLine: 'UNKNOWN, 2',
    sku: null,
    requestedQuantity: 2,
    submittedQuantity: null,
    variantId: null,
    productId: null,
    productName: null,
    resolvedUnitPriceCents: null,
    status: 'skipped',
    reason,
    ...overrides,
  };
}

function response(outcomes: QuickOrderLineOutcome[]): QuickOrderResponse {
  return {
    cart: emptyCart,
    addedLineCount: outcomes.filter((outcome) => outcome.status === 'added').length,
    skippedLineCount: outcomes.filter((outcome) => outcome.status === 'skipped').length,
    outcomes,
  };
}

function renderList(state: Parameters<typeof QuickOrderOutcomeList>[0]['state']) {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <QuickOrderOutcomeList state={state} />
    </MemoryRouter>,
  );
}

const regionName = 'Quick Order result';

describe('QuickOrderOutcomeList', () => {
  it('keeps the named polite status region mounted while idle', () => {
    renderList({ kind: 'idle' });
    const region = screen.getByRole('status', { name: regionName });
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveClass('empty:hidden');
    expect(region).toBeEmptyDOMElement();
  });

  it('separates adjusted and skipped source lines and only links when something was added', () => {
    renderList({
      kind: 'result',
      response: response([
        added({ moqAdjusted: true, requestedQuantity: 1, submittedQuantity: 4 }),
        skipped('INSUFFICIENT_STOCK'),
      ]),
    });

    const region = screen.getByRole('status', { name: regionName });
    expect(region).toHaveTextContent('1 line added to your cart. 1 line could not be added.');

    const adjusted = within(region).getByRole('list', {
      name: 'Amounts adjusted for Quick Order',
    });
    expect(within(adjusted).getByRole('listitem')).toHaveTextContent(
      'Line 1: Portland cement × 4 Amount increased from 1 to 4 to meet the smallest order.',
    );

    const skippedList = within(region).getByRole('list', {
      name: 'Lines not added from Quick Order',
    });
    expect(within(skippedList).getByRole('listitem')).toHaveTextContent(
      'Line 2: Item × 2 There is not enough in stock for this amount.',
    );
    expect(within(region).getByRole('link', { name: 'View cart' })).toHaveAttribute(
      'href',
      '/cart',
    );
  });

  it('renders duplicate SKU outcomes as distinct source lines', () => {
    renderList({
      kind: 'result',
      response: response([
        added({
          lineNumber: 4,
          rawLine: 'CEMENT-25, 1',
          requestedQuantity: 1,
          submittedQuantity: 4,
          moqAdjusted: true,
          duplicateSku: true,
        }),
        added({
          lineNumber: 7,
          rawLine: 'CEMENT-25, 2',
          requestedQuantity: 2,
          submittedQuantity: 4,
          moqAdjusted: true,
          duplicateSku: true,
        }),
      ]),
    });

    const adjusted = screen.getByRole('list', {
      name: 'Amounts adjusted for Quick Order',
    });
    const entries = within(adjusted).getAllByRole('listitem');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveTextContent('Line 4: Portland cement');
    expect(entries[1]).toHaveTextContent('Line 7: Portland cement');
  });

  it('explains an all-skipped result without a cart link', () => {
    renderList({ kind: 'result', response: response([skipped('BELOW_MOQ')]) });

    const region = screen.getByRole('status', { name: regionName });
    expect(region).toHaveTextContent('Nothing was added to your cart. 1 line could not be added.');
    expect(within(region).queryByRole('link', { name: 'View cart' })).not.toBeInTheDocument();
  });

  it('renders a stable error key instead of a stale server message', () => {
    renderList({
      kind: 'error',
      message: 'legacy unlocalised error',
      messageKey: QUICK_ORDER_FAILURE_KEY,
    });

    const region = screen.getByRole('status', { name: regionName });
    expect(region).toHaveTextContent(QUICK_ORDER_FAILURE_MESSAGE);
    expect(region).not.toHaveTextContent('legacy unlocalised error');
  });
});

describe('quick-order presentation copy', () => {
  it('provides buyer copy for every skip reason without internal terms or codes', () => {
    expect(SKIP_REASONS.length).toBeGreaterThan(0);
    for (const reason of SKIP_REASONS) {
      const message = skipReasonMessage(reason);
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toMatch(/MOQ|SKU|variant|_/i);
    }
  });

  it('keeps adjusted and skipped selectors separate', () => {
    const result = response([
      added({ moqAdjusted: true, requestedQuantity: 1, submittedQuantity: 4 }),
      added({ lineNumber: 2 }),
      skipped('MALFORMED_LINE', { lineNumber: 3 }),
    ]);
    expect(adjustedOutcomes(result)).toHaveLength(1);
    expect(skippedOutcomes(result)).toHaveLength(1);
  });

  it('uses the server-reported counts in its summary', () => {
    expect(quickOrderSummaryMessage(response([]))).toBe('No lines were ready to add to your cart.');
    expect(quickOrderSummaryMessage(response([added(), added({ lineNumber: 2 })]))).toBe(
      '2 lines were added to your cart.',
    );
  });
});
