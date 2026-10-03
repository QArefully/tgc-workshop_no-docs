import { createVatRateBasisPoints, type CountryProfile } from './types.js';

export const ES_COUNTRY_PROFILE = {
  language: 'es',
  numberLocale: 'es-ES',
  dateLocale: 'es-ES',
  displayCurrency: 'EUR',
  vatRateBasisPoints: createVatRateBasisPoints(2100),
  exchangeRate: { numerator: 117, denominator: 100 },
  blockedCategories: [],
  blockedProductSlugs: [],
  bannerMessageKey: 'country.banner',
  postcode: {
    pattern: '^[0-9]{5}$',
    labelMessageKey: 'postcode.label',
    example: '28013',
  },
  deliveryCountryCodes: ['ES'],
  timeZone: 'Europe/Madrid',
  deliveryCutoffHour: 16,
} as const satisfies CountryProfile;
