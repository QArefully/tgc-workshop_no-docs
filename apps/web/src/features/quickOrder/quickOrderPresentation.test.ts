import { describe, expect, it } from 'vitest';
import { SUPPORTED_COUNTRIES } from '@shop/contracts/country';
import type { QuickOrderResponse } from '@shop/contracts/quick-order';
import {
  SKIP_REASONS,
  quickOrderSummaryMessage,
  moqAdjustmentMessage,
  outcomeLineLabel,
  skipReasonMessage,
} from './quickOrderPresentation';

const emptyResponse: QuickOrderResponse = {
  cart: {
    id: '58f1b5ed-3dbf-4c3c-908e-c71d7e7bf912',
    items: [],
    subtotalCents: 0,
    discountableSubtotalCents: 0,
    blendingFeeTotalCents: 0,
    totalItems: 0,
  },
  addedLineCount: 1,
  skippedLineCount: 0,
  outcomes: [],
};

describe('Quick Order presentation', () => {
  it('explains the country restriction and includes it in the derived reason list', () => {
    expect(skipReasonMessage('BLOCKED_IN_COUNTRY')).toBe(
      'This item cannot be ordered in your country.',
    );
    expect(SKIP_REASONS).toContain('BLOCKED_IN_COUNTRY');
  });

  it('keeps unknown SKU distinct from country blocking across every country', () => {
    for (const country of SUPPORTED_COUNTRIES) {
      const blocked = skipReasonMessage('BLOCKED_IN_COUNTRY', country);
      const unknown = skipReasonMessage('SKU_NOT_FOUND', country);
      expect(blocked).not.toBe(unknown);
      for (const reason of SKIP_REASONS) {
        const label = skipReasonMessage(reason, country);
        expect(label.trim()).toMatch(/\S/);
        expect(label).not.toMatch(/SKU|variant|_/i);
      }
    }
  });

  it('uses locale-aware plural labels for line summaries', () => {
    expect(quickOrderSummaryMessage(emptyResponse, 'DE')).toContain('Zeile');
  });

  it('formats line numbers, quantities, and summaries for the active country', () => {
    const outcome = {
      lineNumber: 10_000,
      rawLine: 'CEM-25, 10000',
      sku: 'CEM-25',
      requestedQuantity: 10_000,
      submittedQuantity: 20_000,
      moqAdjusted: true,
      duplicateSku: false,
      variantId: 1,
      productId: 'cement',
      productName: 'Cement',
      resolvedUnitPriceCents: 500,
      status: 'added',
      reason: null,
    } as QuickOrderResponse['outcomes'][number];
    expect(outcomeLineLabel(outcome, 'DE')).toBe('Zeile 10.000: Cement × 20.000');
    expect(moqAdjustmentMessage(outcome, 'DE')).toContain('10.000');
    expect(
      quickOrderSummaryMessage(
        { ...emptyResponse, addedLineCount: 10_000, skippedLineCount: 0 },
        'DE',
      ),
    ).toContain('10.000 Zeilen');
  });

  it('does not duplicate Chinese line classifiers around nested count phrases', () => {
    const summary = quickOrderSummaryMessage(
      { ...emptyResponse, addedLineCount: 1, skippedLineCount: 1 },
      'CN',
    );
    expect(summary).toBe('已将 1 行添加到购物车，1 行无法添加。');
    expect(summary).not.toContain('行 行');
  });
});
