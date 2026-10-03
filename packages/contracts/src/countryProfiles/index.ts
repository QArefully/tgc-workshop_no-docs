import type { Country } from '../country.js';
import { CN_COUNTRY_PROFILE } from './cn.js';
import { DE_COUNTRY_PROFILE } from './de.js';
import { ES_COUNTRY_PROFILE } from './es.js';
import { FR_COUNTRY_PROFILE } from './fr.js';
import { PL_COUNTRY_PROFILE } from './pl.js';
import type { CountryProfile } from './types.js';
import { UK_COUNTRY_PROFILE } from './uk.js';
import { US_COUNTRY_PROFILE } from './us.js';

export * from './types.js';

/** Complete checked-in display/business profile lookup for every supported identity country. */
export const COUNTRY_PROFILES: Readonly<Record<Country, CountryProfile>> = {
  UK: UK_COUNTRY_PROFILE,
  US: US_COUNTRY_PROFILE,
  CN: CN_COUNTRY_PROFILE,
  PL: PL_COUNTRY_PROFILE,
  ES: ES_COUNTRY_PROFILE,
  DE: DE_COUNTRY_PROFILE,
  FR: FR_COUNTRY_PROFILE,
};

/** Returns the profile for a supported identity country. */
export function countryProfile(country: Country): CountryProfile {
  return COUNTRY_PROFILES[country];
}
