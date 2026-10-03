import { createVatRateBasisPoints, type CountryProfile } from './types.js';

export const FR_COUNTRY_PROFILE = {
  language: 'fr',
  numberLocale: 'fr-FR',
  dateLocale: 'fr-FR',
  displayCurrency: 'EUR',
  vatRateBasisPoints: createVatRateBasisPoints(2000),
  exchangeRate: { numerator: 117, denominator: 100 },
  blockedCategories: [],
  blockedProductSlugs: [],
  bannerMessageKey: undefined,
  postcode: {
    pattern: '^[0-9]{5}$',
    labelMessageKey: 'postcode.label',
    example: '75001',
  },
  deliveryCountryCodes: ['FR'],
  timeZone: 'Europe/Paris',
  deliveryCutoffHour: 16,
} as const satisfies CountryProfile;
