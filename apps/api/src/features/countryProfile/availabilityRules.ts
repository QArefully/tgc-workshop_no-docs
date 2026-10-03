import type { CountryProfile } from '@shop/contracts/country-profiles';

/** Whether a catalogue category is unavailable under the supplied country profile. */
export function isCategoryBlocked(profile: CountryProfile, category: string): boolean {
  return profile.blockedCategories.includes(category);
}

/** Whether an individual product is unavailable under the supplied country profile. */
export function isProductBlocked(profile: CountryProfile, slug: string): boolean {
  return profile.blockedProductSlugs.includes(slug);
}

/** Returns the profile's immutable category exclusions. */
export function blockedCategoriesFor(profile: CountryProfile): readonly string[] {
  return profile.blockedCategories;
}

/** Returns the profile's immutable product-slug exclusions. */
export function blockedSlugsFor(profile: CountryProfile): readonly string[] {
  return profile.blockedProductSlugs;
}
