import assert from 'node:assert/strict';
import test from 'node:test';
import type { Country } from '@shop/contracts/country';
import { COUNTRY_PROFILES } from '@shop/contracts/country-profiles';
import { isDeliverableCountryCode, validatePostcodeForCountry } from './addressRules.js';

const POSTCODE_CASES: Readonly<
  Record<Country, { valid: string; neighbour: string; neighbourName: string }>
> = {
  UK: { valid: 'SW1A 1AA', neighbour: 'D02 X285', neighbourName: 'Irish Eircode' },
  US: { valid: '10001', neighbour: 'K1A 0B1', neighbourName: 'Canadian postal code' },
  CN: { valid: '100000', neighbour: '100-0001', neighbourName: 'Japanese postal code' },
  PL: { valid: '00-001', neighbour: '10115', neighbourName: 'German postcode' },
  ES: { valid: '28013', neighbour: '1000-001', neighbourName: 'Portuguese postcode' },
  DE: { valid: '10115', neighbour: '00-001', neighbourName: 'Polish postcode' },
  FR: { valid: '75001', neighbour: '1000', neighbourName: 'Belgian postcode' },
};

void test('postcode profiles accept their example and reject a neighbouring-country format', () => {
  for (const [country, postcodeCase] of Object.entries(POSTCODE_CASES) as [
    Country,
    (typeof POSTCODE_CASES)[Country],
  ][]) {
    const profile = COUNTRY_PROFILES[country];
    assert.equal(validatePostcodeForCountry(profile, postcodeCase.valid), true, country);
    assert.equal(
      validatePostcodeForCountry(profile, postcodeCase.neighbour),
      false,
      `${country} must reject ${postcodeCase.neighbourName} ${postcodeCase.neighbour}`,
    );
  }
});

void test('delivery routing uses each profile allowlist rather than comparing country axes', () => {
  const cases = [
    ['UK', 'GB', 'US'],
    ['US', 'US', 'GB'],
    ['CN', 'CN', 'PL'],
    ['PL', 'PL', 'DE'],
    ['ES', 'ES', 'FR'],
    ['DE', 'DE', 'PL'],
    ['FR', 'FR', 'DE'],
  ] as const satisfies readonly [Country, string, string][];

  for (const [country, allowed, refused] of cases) {
    const profile = COUNTRY_PROFILES[country];
    assert.equal(isDeliverableCountryCode(profile, allowed), true, country);
    assert.equal(isDeliverableCountryCode(profile, refused), false, country);
  }
});
