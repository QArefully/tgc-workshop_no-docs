import { createVatRateBasisPoints, type CountryProfile } from './types.js';

export const PL_COUNTRY_PROFILE = {
  language: 'pl',
  numberLocale: 'pl-PL',
  dateLocale: 'pl-PL',
  displayCurrency: 'PLN',
  vatRateBasisPoints: createVatRateBasisPoints(2300),
  exchangeRate: { numerator: 5, denominator: 1 },
  blockedCategories: [],
  blockedProductSlugs: [],
  bannerMessageKey: undefined,
  postcode: {
    pattern: '^[0-9]{2}-[0-9]{3}$',
    labelMessageKey: 'postcode.label',
    example: '00-001',
  },
  deliveryCountryCodes: ['PL'],
  timeZone: 'Europe/Warsaw',
  deliveryCutoffHour: 16,
} as const satisfies CountryProfile;
