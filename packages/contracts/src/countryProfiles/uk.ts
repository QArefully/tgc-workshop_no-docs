import { createVatRateBasisPoints, type CountryProfile } from './types.js';

export const UK_COUNTRY_PROFILE = {
  language: 'en',
  numberLocale: 'en-GB',
  dateLocale: 'en-GB',
  displayCurrency: 'GBP',
  vatRateBasisPoints: createVatRateBasisPoints(2000),
  exchangeRate: { numerator: 1, denominator: 1 },
  blockedCategories: [],
  blockedProductSlugs: [],
  bannerMessageKey: undefined,
  postcode: {
    pattern: '^(?:GIR 0AA|[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2})$',
    labelMessageKey: 'postcode.label',
    example: 'SW1A 1AA',
  },
  deliveryCountryCodes: ['GB'],
  timeZone: 'Europe/London',
  deliveryCutoffHour: 16,
} as const satisfies CountryProfile;
