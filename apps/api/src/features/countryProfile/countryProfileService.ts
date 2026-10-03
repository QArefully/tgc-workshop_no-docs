import type Database from 'better-sqlite3';
import type { Country } from '@shop/contracts/country';
import {
  COUNTRY_PROFILES,
  countryProfile,
  type CountryProfile,
} from '@shop/contracts/country-profiles';
import {
  blockedCategoriesFor,
  blockedSlugsFor,
  isCategoryBlocked,
  isProductBlocked,
} from './availabilityRules.js';

export interface CountryProfileService {
  profile(country: Country): CountryProfile;
  isCategoryBlocked(country: Country, category: string): boolean;
  isProductBlocked(country: Country, slug: string): boolean;
  blockedCategoriesFor(country: Country): readonly string[];
  blockedSlugsFor(country: Country): readonly string[];
}

/** Creates a process-local facade over the checked-in, database-free country profiles. */
export function createCountryProfileService(): CountryProfileService {
  return {
    profile: countryProfile,
    isCategoryBlocked(country, category) {
      return isCategoryBlocked(countryProfile(country), category);
    },
    isProductBlocked(country, slug) {
      return isProductBlocked(countryProfile(country), slug);
    },
    blockedCategoriesFor(country) {
      return blockedCategoriesFor(countryProfile(country));
    },
    blockedSlugsFor(country) {
      return blockedSlugsFor(countryProfile(country));
    },
  };
}

/**
 * Verifies that every checked-in exclusion still names a persisted catalogue category or product.
 * This is intentionally explicit startup/seed validation, never a request-path lookup.
 */
export function assertProfilesMatchCatalog(db: Database.Database): void {
  const categories = new Set(
    db.prepare('SELECT DISTINCT category FROM products').pluck().all() as string[],
  );
  const slugs = new Set(db.prepare('SELECT DISTINCT slug FROM products').pluck().all() as string[]);

  for (const [country, profile] of Object.entries(COUNTRY_PROFILES)) {
    for (const category of profile.blockedCategories) {
      if (!categories.has(category)) {
        throw new Error(`Country profile ${country} references unknown category: ${category}`);
      }
    }
    for (const slug of profile.blockedProductSlugs) {
      if (!slugs.has(slug)) {
        throw new Error(`Country profile ${country} references unknown product slug: ${slug}`);
      }
    }
  }
}
