import { describe, expect, it } from 'vitest';
import type { CustomBlendSnapshot } from '@shop/contracts/custom-blends';
import { formatCivilDate, formatDualTotal, translate } from '@shop/localisation';
import { checkoutMessages } from '@shop/localisation/messages/checkout';
import {
  customBlendCompositionLabel,
  customBlendMadeToOrderNote,
} from '@/features/customBlend/CustomBlendPackaging';
import { translatePaymentError } from './checkoutCopy';

describe('checkout localisation boundaries', () => {
  it('shows local plus authoritative GBP at non-UK checkout totals and deduplicates UK', () => {
    expect(formatDualTotal(1000, 'DE')).toEqual({ display: '11,70 €', settlement: '£10.00' });
    expect(formatDualTotal(1000, 'UK')).toEqual({ display: '£10.00' });
  });

  it('formats booked delivery dates as civil dates without a timezone day shift', () => {
    expect(formatCivilDate('2026-08-03', 'US', 'long')).toBe('August 3, 2026');
    expect(formatCivilDate('2026-08-03', 'DE', 'long')).toBe('3. August 2026');
  });

  it('resolves code-based promo copy in every country', () => {
    const translated = translate(checkoutMessages, 'DE', 'checkout.promoError.minSubtotalAmount', {
      money: '11,70 €',
    });
    expect(translated).toContain('11,70');
    expect(translated).not.toBe(
      translate(checkoutMessages, 'US', 'checkout.promoError.minSubtotalAmount', {
        money: '£10.00',
      }),
    );
  });

  it('maps payment failure codes to translated safe copy', () => {
    const de = (key: keyof typeof checkoutMessages, params?: Record<string, string | number>) =>
      translate(checkoutMessages, 'DE', key, params);
    expect(translatePaymentError('CARD_DECLINED', 402, 'raw gateway text', de)).toContain(
      'abgelehnt',
    );
    expect(translatePaymentError('GATEWAY_TIMEOUT', 402, 'raw gateway text', de)).toContain(
      'Zeitüberschreitung',
    );
  });

  it('uses country-aware Custom Blend disclosure helpers in checkout', () => {
    const blend: CustomBlendSnapshot = {
      configKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      basePercentage: 90,
      ingredients: [
        {
          productId: '2',
          variantId: 2,
          productName: 'Chalk',
          productDescription: 'Chalk filler',
          mixingGroup: 'aggregate',
          percentage: 10,
        },
      ],
      mixingGroup: 'aggregate',
      blendingFeeCents: 100,
      madeToOrder: true,
      returnable: false,
    };
    expect(customBlendMadeToOrderNote('DE')).toContain('Auf Bestellung');
    expect(customBlendCompositionLabel('Cement', blend, 'DE')).toContain('Cement');
    expect(translate(checkoutMessages, 'DE', 'checkout.customBlend.resultNonFood')).toBe(
      'Nicht für Lebensmittel bestimmte Mischung',
    );
    expect(translate(checkoutMessages, 'DE', 'checkout.customBlend.notForConsumption')).toBe(
      'Nicht zum Verzehr geeignet',
    );
  });
});
