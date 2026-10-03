import assert from 'node:assert/strict';
import test from 'node:test';
import { SUPPORTED_COUNTRIES, type Country } from '../src/country.js';
import {
  COUNTRY_PROFILES,
  countryProfile,
  createVatRateBasisPoints,
  type CountryProfile,
} from '../src/countryProfiles/index.js';

const foreignExampleCountry = {
  UK: 'FR',
  US: 'CN',
  CN: 'PL',
  PL: 'DE',
  ES: 'UK',
  DE: 'PL',
  FR: 'UK',
} as const satisfies Readonly<Record<Country, Country>>;

const expectedDisplayMetadata = {
  UK: {
    language: 'en',
    numberLocale: 'en-GB',
    dateLocale: 'en-GB',
    displayCurrency: 'GBP',
    vatRateBasisPoints: createVatRateBasisPoints(2000),
    exchangeRate: [1, 1],
    bannerMessageKey: undefined,
  },
  US: {
    language: 'en',
    numberLocale: 'en-US',
    dateLocale: 'en-US',
    displayCurrency: 'USD',
    vatRateBasisPoints: createVatRateBasisPoints(0),
    exchangeRate: [5, 4],
    bannerMessageKey: undefined,
  },
  CN: {
    language: 'zh',
    numberLocale: 'zh-CN',
    dateLocale: 'zh-CN',
    displayCurrency: 'CNY',
    vatRateBasisPoints: createVatRateBasisPoints(1300),
    exchangeRate: [9, 1],
    bannerMessageKey: undefined,
  },
  PL: {
    language: 'pl',
    numberLocale: 'pl-PL',
    dateLocale: 'pl-PL',
    displayCurrency: 'PLN',
    vatRateBasisPoints: createVatRateBasisPoints(2300),
    exchangeRate: [5, 1],
    bannerMessageKey: undefined,
  },
  ES: {
    language: 'es',
    numberLocale: 'es-ES',
    dateLocale: 'es-ES',
    displayCurrency: 'EUR',
    vatRateBasisPoints: createVatRateBasisPoints(2100),
    exchangeRate: [117, 100],
    bannerMessageKey: 'country.banner',
  },
  DE: {
    language: 'de',
    numberLocale: 'de-DE',
    dateLocale: 'de-DE',
    displayCurrency: 'EUR',
    vatRateBasisPoints: createVatRateBasisPoints(1900),
    exchangeRate: [117, 100],
    bannerMessageKey: undefined,
  },
  FR: {
    language: 'fr',
    numberLocale: 'fr-FR',
    dateLocale: 'fr-FR',
    displayCurrency: 'EUR',
    vatRateBasisPoints: createVatRateBasisPoints(2000),
    exchangeRate: [117, 100],
    bannerMessageKey: undefined,
  },
} as const satisfies Readonly<
  Record<
    Country,
    Pick<
      CountryProfile,
      'language' | 'numberLocale' | 'dateLocale' | 'displayCurrency' | 'vatRateBasisPoints'
    > & {
      exchangeRate: readonly [number, number];
      bannerMessageKey: string | undefined;
    }
  >
>;

void test('profiles are total over supported countries', () => {
  assert.deepStrictEqual(Object.keys(COUNTRY_PROFILES), SUPPORTED_COUNTRIES);

  for (const country of SUPPORTED_COUNTRIES) {
    const profile: CountryProfile = countryProfile(country);
    assert.strictEqual(profile, COUNTRY_PROFILES[country]);
  }
});

void test('display metadata has the exact seven-country fixtures', () => {
  for (const country of SUPPORTED_COUNTRIES) {
    const profile = countryProfile(country);
    const expected = expectedDisplayMetadata[country];

    assert.deepStrictEqual(
      {
        language: profile.language,
        numberLocale: profile.numberLocale,
        dateLocale: profile.dateLocale,
        displayCurrency: profile.displayCurrency,
        vatRateBasisPoints: profile.vatRateBasisPoints,
        exchangeRate: [profile.exchangeRate.numerator, profile.exchangeRate.denominator],
        bannerMessageKey: profile.bannerMessageKey,
      },
      expected,
    );
  }
});

void test('VAT rates are immutable integer basis-point values in the inclusive 0..10000 range', () => {
  for (const country of SUPPORTED_COUNTRIES) {
    const profile = countryProfile(country);
    const value = profile.vatRateBasisPoints;

    assert.equal(Number.isSafeInteger(value), true, `${country} VAT rate integer`);
    assert.ok(value >= 0, `${country} VAT rate lower bound`);
    assert.ok(value <= 10_000, `${country} VAT rate upper bound`);
  }
});

void test('VAT rate construction rejects values outside the safe 0..10000 integer range', () => {
  for (const value of [1.5, -1, 10_001, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => createVatRateBasisPoints(value), RangeError, `${value} is rejected`);
  }

  assert.equal(createVatRateBasisPoints(0), 0);
  assert.equal(createVatRateBasisPoints(10_000), 10_000);
});

void test('display metadata has constructible Intl locales/currencies/time zones and positive rates', () => {
  for (const country of SUPPORTED_COUNTRIES) {
    const profile = countryProfile(country);

    assert.doesNotThrow(() => new Intl.PluralRules(profile.language), `${country} language`);
    assert.doesNotThrow(
      () => new Intl.NumberFormat(profile.numberLocale),
      `${country} number locale`,
    );
    assert.doesNotThrow(
      () =>
        new Intl.NumberFormat(profile.numberLocale, {
          style: 'currency',
          currency: profile.displayCurrency,
        }),
      `${country} display currency`,
    );
    assert.doesNotThrow(
      () => new Intl.DateTimeFormat(profile.dateLocale, { timeZone: profile.timeZone }),
      `${country} date locale/time zone`,
    );

    for (const [name, value] of Object.entries(profile.exchangeRate)) {
      assert.equal(Number.isSafeInteger(value), true, `${country} ${name} integer`);
      assert.ok(value > 0, `${country} ${name} positive`);
    }
  }
});

void test('postcode patterns are anchored and country-specific', () => {
  for (const country of SUPPORTED_COUNTRIES) {
    const profile = countryProfile(country);
    const pattern = new RegExp(profile.postcode.pattern);
    const neighbourExample = countryProfile(foreignExampleCountry[country]).postcode.example;

    assert.equal(profile.postcode.pattern.startsWith('^'), true, `${country} pattern start`);
    assert.equal(profile.postcode.pattern.endsWith('$'), true, `${country} pattern end`);
    assert.equal(pattern.test(profile.postcode.example), true, `${country} own example`);
    assert.equal(pattern.test(neighbourExample), false, `${country} foreign example`);
  }
});

void test('delivery rules have a destination and a valid local cut-off hour', () => {
  for (const country of SUPPORTED_COUNTRIES) {
    const profile = countryProfile(country);
    assert.ok(profile.deliveryCountryCodes.length > 0, `${country} delivery countries`);
    assert.ok(profile.deliveryCutoffHour >= 0, `${country} cut-off lower bound`);
    assert.ok(profile.deliveryCutoffHour <= 23, `${country} cut-off upper bound`);
  }
});

void test('country copy uses stable lookup keys', () => {
  for (const country of SUPPORTED_COUNTRIES) {
    const profile = countryProfile(country);
    assert.equal(profile.postcode.labelMessageKey, 'postcode.label');
  }
  assert.equal(countryProfile('ES').bannerMessageKey, 'country.banner');
});

void test('exactly one country blocks one live category', () => {
  const categoryBlocks = SUPPORTED_COUNTRIES.flatMap((country) =>
    countryProfile(country).blockedCategories.map((category) => ({ country, category })),
  );
  assert.deepStrictEqual(categoryBlocks, [{ country: 'CN', category: 'Sports Nutrition' }]);
});
