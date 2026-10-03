import { describe, expect, it } from 'vitest';
import { SUPPORTED_COUNTRIES } from '@shop/contracts/country';
import { countryProfile } from '@shop/contracts/country-profiles';
import { formatDisplayMoney } from '@shop/localisation';
import type { ReorderLineOutcome, ReorderResponse } from '@shop/contracts/reorder';
import {
  SKIP_REASONS,
  outcomeLineLabel,
  priceChangeMessage,
  reorderSummaryMessage,
  skipReasonMessage,
} from './reorderPresentation';

describe('reorder presentation', () => {
  it('explains the country restriction and includes it in the derived reason list', () => {
    expect(skipReasonMessage('BLOCKED_IN_COUNTRY')).toBe(
      'This item cannot be ordered in your country.',
    );
    expect(SKIP_REASONS).toContain('BLOCKED_IN_COUNTRY');
  });

  it('covers every skip code in every supported country', () => {
    for (const country of SUPPORTED_COUNTRIES) {
      for (const reason of SKIP_REASONS) {
        const label = skipReasonMessage(reason, country);
        expect(label.trim()).toMatch(/\S/);
        expect(label).not.toMatch(/SKU|variant|_/i);
      }
    }
  });

  it('formats price drift with active-country display money', () => {
    const outcome: ReorderLineOutcome = {
      orderLineItemId: '1',
      productId: 'cement',
      productName: 'Cement',
      variantId: 1,
      sku: 'CEM-25',
      configKey: '',
      quantity: 1,
      status: 'added',
      reason: null,
      orderedUnitPriceCents: 900,
      currentUnitPriceCents: 1050,
      priceChanged: true,
    };
    const germanMoney = (pence: number) => formatDisplayMoney(pence, countryProfile('DE'));
    const message = priceChangeMessage(outcome, 'DE', germanMoney);
    const currentUnitPriceCents = outcome.currentUnitPriceCents;
    if (currentUnitPriceCents === null)
      throw new Error('Price-change fixture requires current price.');
    expect(message).toContain(germanMoney(outcome.orderedUnitPriceCents));
    expect(message).toContain(germanMoney(currentUnitPriceCents));
    expect(outcomeLineLabel(outcome, 'DE')).toContain('Cement');
  });

  it('uses country plural branches for reorder summaries', () => {
    const response = {
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
    } as unknown as ReorderResponse;
    expect(reorderSummaryMessage(response, 'DE')).toContain('Artikel');
  });

  it('formats quantities and summaries with active-country count grouping', () => {
    const outcome: ReorderLineOutcome = {
      orderLineItemId: '2',
      productId: 'cement',
      productName: 'Cement',
      variantId: 1,
      sku: 'CEM-25',
      configKey: '',
      quantity: 10_000,
      status: 'added',
      reason: null,
      orderedUnitPriceCents: 900,
      currentUnitPriceCents: 900,
      priceChanged: false,
    };
    expect(outcomeLineLabel(outcome, 'DE')).toBe('Cement × 10.000');
    expect(
      reorderSummaryMessage(
        {
          cart: {
            id: '58f1b5ed-3dbf-4c3c-908e-c71d7e7bf912',
            items: [],
            subtotalCents: 0,
            discountableSubtotalCents: 0,
            blendingFeeTotalCents: 0,
            totalItems: 0,
          },
          addedLineCount: 10_000,
          skippedLineCount: 0,
          outcomes: [],
        },
        'DE',
      ),
    ).toContain('10.000 Artikel');
  });

  it('does not duplicate Chinese item classifiers around nested count phrases', () => {
    const summary = reorderSummaryMessage(
      {
        cart: {
          id: '58f1b5ed-3dbf-4c3c-908e-c71d7e7bf912',
          items: [],
          subtotalCents: 0,
          discountableSubtotalCents: 0,
          blendingFeeTotalCents: 0,
          totalItems: 0,
        },
        addedLineCount: 1,
        skippedLineCount: 1,
        outcomes: [],
      },
      'CN',
    );
    expect(summary).toBe('已将 1 个项目添加到购物车，1 个项目无法添加。');
    expect(summary).not.toContain('个项目 个项目');
  });
});
