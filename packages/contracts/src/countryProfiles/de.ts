import { createVatRateBasisPoints, type CountryProfile } from './types.js';

export const DE_COUNTRY_PROFILE = {
  language: 'de',
  numberLocale: 'de-DE',
  dateLocale: 'de-DE',
  displayCurrency: 'EUR',
  vatRateBasisPoints: createVatRateBasisPoints(1900),
  exchangeRate: { numerator: 117, denominator: 100 },
  blockedCategories: [],
  blockedProductSlugs: [],
  bannerMessageKey: undefined,
  postcode: {
    pattern: '^[0-9]{5}$',
    labelMessageKey: 'postcode.label',
    example: '10115',
  },
  deliveryCountryCodes: ['DE'],
  timeZone: 'Europe/Berlin',
  deliveryCutoffHour: 16,
} as const satisfies CountryProfile;
