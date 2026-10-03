import { createVatRateBasisPoints, type CountryProfile } from './types.js';

export const US_COUNTRY_PROFILE = {
  language: 'en',
  numberLocale: 'en-US',
  dateLocale: 'en-US',
  displayCurrency: 'USD',
  vatRateBasisPoints: createVatRateBasisPoints(0),
  exchangeRate: { numerator: 5, denominator: 4 },
  blockedCategories: [],
  blockedProductSlugs: [],
  bannerMessageKey: undefined,
  postcode: {
    pattern: '^[0-9]{5}$',
    labelMessageKey: 'postcode.label',
    example: '10001',
  },
  deliveryCountryCodes: ['US'],
  timeZone: 'America/New_York',
  deliveryCutoffHour: 16,
} as const satisfies CountryProfile;
