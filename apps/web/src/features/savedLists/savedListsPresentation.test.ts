import { describe, expect, it } from 'vitest';
import { SUPPORTED_COUNTRIES } from '@shop/contracts/country';
import type { SavedListAddToCartResponse, SavedListLineOutcome } from '@shop/contracts/saved-lists';
import {
  SAVED_LIST_SKIP_REASONS,
  savedListAdjustmentMessage,
  savedListOutcomeLabel,
  savedListSkipReasonLabel,
  savedListSummaryMessage,
} from './savedListsPresentation';

const outcome: SavedListLineOutcome = {
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
};
const response = (outcomes: SavedListLineOutcome[]): SavedListAddToCartResponse => ({
  cart: {
    id: '5e6f7a8b-1c2d-4e3f-8a9b-0c1d2e3f4a5b',
    items: [],
    subtotalCents: 0,
    discountableSubtotalCents: 0,
    blendingFeeTotalCents: 0,
    totalItems: 0,
  },
  addedLineCount: outcomes.filter((entry) => entry.status === 'added').length,
  skippedLineCount: outcomes.filter((entry) => entry.status === 'skipped').length,
  outcomes,
});

describe('saved-list presentation', () => {
  it('explains the country restriction and includes it in the derived reason list', () => {
    expect(savedListSkipReasonLabel('BLOCKED_IN_COUNTRY')).toBe(
      'This item cannot be ordered in your country.',
    );
    expect(SAVED_LIST_SKIP_REASONS).toContain('BLOCKED_IN_COUNTRY');
  });

  it('has buyer copy for every contract skip reason', () => {
    for (const reason of SAVED_LIST_SKIP_REASONS) {
      expect(savedListSkipReasonLabel(reason)).toMatch(/\.$/);
      expect(savedListSkipReasonLabel(reason)).not.toMatch(/SKU|variant|_/i);
    }
  });
  it('only reports adjustments supplied by the server', () => {
    expect(savedListAdjustmentMessage(outcome)).toContain('increased from 1 to 4');
    expect(savedListAdjustmentMessage({ ...outcome, moqAdjusted: false })).toBeNull();
  });
  it('summarises a mixed server report', () => {
    expect(
      savedListSummaryMessage(
        response([
          outcome,
          {
            ...outcome,
            itemId: '2',
            status: 'skipped',
            reason: 'VARIANT_RETIRED',
            submittedQuantity: null,
            moqAdjusted: false,
            resolvedUnitPriceCents: null,
          },
        ]),
      ),
    ).toBe('1 item added to your cart. 1 item could not be added.');
  });

  it('resolves every saved-list skip code in every supported country', () => {
    for (const country of SUPPORTED_COUNTRIES) {
      for (const reason of SAVED_LIST_SKIP_REASONS) {
        const label = savedListSkipReasonLabel(reason, country);
        expect(label.trim()).toMatch(/\S/);
        expect(label).not.toMatch(/SKU|variant|_/i);
      }
    }
  });

  it('uses locale plural copy when a country is supplied', () => {
    const addedOnly = response([outcome]);
    expect(savedListSummaryMessage(addedOnly, 'DE')).toContain('Artikel');
    expect(savedListSummaryMessage(addedOnly, 'DE')).not.toBe(savedListSummaryMessage(addedOnly));
  });

  it('formats saved-list counts with the active country formatter', () => {
    const large = {
      ...response([]),
      addedLineCount: 10_000,
      skippedLineCount: 0,
    };
    expect(savedListSummaryMessage(large, 'DE')).toBe(
      '10.000 Artikel wurden in den Warenkorb gelegt.',
    );
    expect(
      savedListAdjustmentMessage(
        { ...outcome, savedQuantity: 10_000, submittedQuantity: 20_000 },
        'DE',
      ),
    ).toContain('10.000');
    expect(savedListOutcomeLabel({ ...outcome, savedQuantity: 10_000 }, 'DE')).toBe(
      'Cement × 10.000',
    );
  });

  it('does not duplicate Chinese item classifiers around nested count phrases', () => {
    const mixed = response([
      outcome,
      {
        ...outcome,
        itemId: '2',
        status: 'skipped',
        reason: 'VARIANT_RETIRED',
        submittedQuantity: null,
        moqAdjusted: false,
        resolvedUnitPriceCents: null,
      },
    ]);
    const summary = savedListSummaryMessage(mixed, 'CN');
    expect(summary).toBe('已将 1 个项目添加到购物车，1 个项目无法添加。');
    expect(summary).not.toContain('个项目 个项目');
  });
});
