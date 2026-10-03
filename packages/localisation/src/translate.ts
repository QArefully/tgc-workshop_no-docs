import type { Country } from '@shop/contracts/country';
import { countryProfile, type CountryLanguage } from '@shop/contracts/country-profiles';
import type { MessageCatalog, MessageTemplate } from './messages/defineMessages.js';

export type MessageParams = Readonly<Record<string, string | number | bigint>>;

const PLACEHOLDER_PATTERN = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;
const pluralRules = new Map<string, Intl.PluralRules>();

function getPluralRules(language: CountryLanguage, locale: string): Intl.PluralRules {
  const key = `${language}|${locale}`;
  let formatter = pluralRules.get(key);
  if (formatter === undefined) {
    formatter = new Intl.PluralRules(locale || language);
    pluralRules.set(key, formatter);
  }
  return formatter;
}

function interpolate(template: string, params: MessageParams, path: string): string {
  return template.replace(PLACEHOLDER_PATTERN, (_match, name: string) => {
    if (!(name in params))
      throw new Error(`Missing parameter {${name}} for localisation message ${path}`);
    // Templates are plain text. React/API consumers own output escaping at
    // their boundary; entity-encoding here would make visible angle brackets
    // render as literal `&lt;` text in those consumers.
    return String(params[name]);
  });
}

function selectTemplate(
  template: MessageTemplate,
  country: Country,
  params: MessageParams,
): string {
  if (typeof template === 'string') return template;
  const branches = 'plural' in template ? template.plural : template;
  const count = params.count;
  if (count === undefined) {
    throw new Error(`Plural localisation message for ${country} requires a count parameter`);
  }
  if (
    typeof count === 'bigint' &&
    (count > BigInt(Number.MAX_SAFE_INTEGER) || count < BigInt(-Number.MAX_SAFE_INTEGER))
  ) {
    throw new RangeError(`Plural count for ${country} must be within the safe integer range`);
  }
  const numericCount = typeof count === 'bigint' ? Number(count) : count;
  if (typeof numericCount !== 'number')
    throw new Error(`Plural count for ${country} must be numeric`);
  if (!Number.isFinite(numericCount)) throw new Error(`Plural count for ${country} must be finite`);
  const profile = countryProfile(country);
  const category = getPluralRules(profile.language, profile.numberLocale).select(numericCount);
  return branches[category] ?? branches.other;
}

/**
 * Resolve one message for a country. Missing keys/countries and parameters are
 * errors by design; there is no language fallback that could hide a catalogue
 * defect.
 */
export function translate<C extends MessageCatalog, K extends keyof C & string>(
  catalog: C,
  country: Country,
  key: K,
  params: MessageParams = {},
): string {
  const entries = catalog[key];
  if (entries === undefined) throw new Error(`Unknown localisation message key: ${key}`);
  if (!(country in entries)) throw new Error(`Localisation message ${key} has no ${country} entry`);
  const template = entries[country];
  if (template === undefined)
    throw new Error(`Localisation message ${key} has no ${country} entry`);
  return interpolate(selectTemplate(template, country, params), params, `${key}.${country}`);
}

/** Runtime-friendly overload for dynamically selected feature bundles. */
export function translateUnchecked(
  catalog: MessageCatalog,
  country: Country,
  key: string,
  params: MessageParams = {},
): string {
  return translate(catalog, country, key, params);
}

/**
 * Compatibility helper retained for callers that imported the old name. The
 * localisation runtime intentionally returns plain interpolation text and
 * does not provide an HTML-template path.
 */
export function escapeInterpolation(value: string): string {
  return value;
}
