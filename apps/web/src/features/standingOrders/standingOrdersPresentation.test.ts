import { describe, expect, it } from 'vitest';
import type { StandingOrderLineOutcome } from '@shop/contracts/standing-orders';
import {
  STANDING_ORDER_CADENCES,
  standingOrderCadenceLabel,
  standingOrderErrorMessage,
  standingOrderSkipReasonLabel,
} from './standingOrdersPresentation';
import { ApiError } from '@/api/client';
import { translateTradeAsync } from '@shop/localisation/messages/tradeAsync';
import { apiErrors } from '@shop/localisation/messages/apiErrors';
import { translate } from '@shop/localisation';

const outcome = (reason: StandingOrderLineOutcome['reason']): StandingOrderLineOutcome => ({
  orderLineItemId: '1',
  productId: 'cement',
  productName: 'Cement',
  variantId: 1,
  sku: 'CEM',
  configKey: '',
  quantity: 4,
  status: 'skipped',
  reason,
  orderedUnitPriceCents: 100,
  currentUnitPriceCents: 100,
  priceChanged: false,
});

describe('standing-order presentation', () => {
  it('labels every supported cadence', () => {
    expect(STANDING_ORDER_CADENCES.map((value) => standingOrderCadenceLabel(value))).toEqual([
      'Weekly',
      'Every two weeks',
      'Monthly',
    ]);
  });
  it.each([
    'VARIANT_RETIRED',
    'VARIANT_UNRESOLVED',
    'INSUFFICIENT_STOCK',
    'BELOW_MOQ',
    'INVALID_QUANTITY',
    'BLEND_UNAVAILABLE',
  ] as const)('maps skip %s to buyer copy', (reason) => {
    expect(standingOrderSkipReasonLabel(outcome(reason))).toMatch(/\.$/);
  });

  it('maps coded API failures through selected-country copy without raw error prose', () => {
    const error = new ApiError('raw domain failure', 404, {
      error: 'raw domain failure',
      code: 'SOURCE_NOT_FOUND',
    });
    const feature = (
      key: Parameters<typeof translateTradeAsync>[1],
      params?: Readonly<Record<string, string | number | bigint>>,
    ) => translateTradeAsync('DE', key, params);
    const api = (key: string, params?: Readonly<Record<string, string | number | bigint>>) =>
      translate(apiErrors, 'DE', key, params);
    const rendered = standingOrderErrorMessage(error, feature, api);
    expect(rendered).not.toContain('raw domain failure');
    expect(rendered).toContain('Anfrage');
  });
});
