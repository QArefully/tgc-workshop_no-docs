import { SUPPORTED_COUNTRIES, type Country } from '@shop/contracts/country';

/** A plain message or a locale-aware plural message. */
export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

export type PluralTemplate = Readonly<
  Partial<Record<Exclude<PluralCategory, 'other'>, string>> & {
    other: string;
  }
>;

/**
 * A second `plural` spelling is accepted for callers that prefer an explicit
 * discriminator. Both forms are normalised by the translator.
 */
export type ExplicitPluralTemplate = Readonly<{ plural: PluralTemplate }>;
export type MessageTemplate = string | PluralTemplate | ExplicitPluralTemplate;
export type CountryMessageSet = Readonly<Record<Country, MessageTemplate>>;
export type MessageCatalog = Readonly<Record<string, CountryMessageSet>>;

const PLACEHOLDER_PATTERN = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;
const PLURAL_CATEGORIES = new Set<PluralCategory>(['zero', 'one', 'two', 'few', 'many', 'other']);

function placeholderNames(template: string): ReadonlySet<string> {
  const names = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
    names.add(match[1]!);
  }
  return names;
}

function templateBranches(template: MessageTemplate): Readonly<Record<string, string>> {
  if (typeof template === 'string') return { plain: template };
  if ('plural' in template) return template.plural;
  return template;
}

function isPluralTemplate(
  template: MessageTemplate,
): template is PluralTemplate | ExplicitPluralTemplate {
  return typeof template !== 'string';
}

function assertNonEmpty(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Localisation message ${path} must be a non-empty string`);
  }
}

function assertPlaceholderParity(
  expected: ReadonlySet<string>,
  actual: ReadonlySet<string>,
  path: string,
): void {
  const missing = [...expected].filter((name) => !actual.has(name));
  const extra = [...actual].filter((name) => !expected.has(name));
  if (missing.length > 0 || extra.length > 0) {
    const details = [
      ...(missing.length > 0 ? [`missing {${missing.join('}, {')}}`] : []),
      ...(extra.length > 0 ? [`extra {${extra.join('}, {')}}`] : []),
    ].join('; ');
    throw new Error(`Localisation placeholder mismatch at ${path}: ${details}`);
  }
}

function assertTemplate(template: MessageTemplate, path: string): void {
  if (typeof template === 'string') {
    assertNonEmpty(template, path);
    return;
  }

  const branches = templateBranches(template);
  if ('plural' in template && (template.plural === null || typeof template.plural !== 'object')) {
    throw new Error(`Localisation plural message ${path} must be an object`);
  }
  if (!Object.prototype.hasOwnProperty.call(branches, 'other')) {
    throw new Error(`Localisation plural message ${path} must define an other branch`);
  }
  for (const [category, value] of Object.entries(branches)) {
    if (!PLURAL_CATEGORIES.has(category as PluralCategory)) {
      throw new Error(`Localisation plural message ${path} has unsupported branch ${category}`);
    }
    assertNonEmpty(value, `${path}.${category}`);
  }
}

/**
 * Define a feature message bundle. Runtime validation deliberately repeats the
 * type-level exhaustive-country contract so malformed JavaScript/JSON cannot
 * silently reach a buyer.
 */
export function defineMessages<const T extends Record<string, CountryMessageSet>>(
  catalog: T,
): Readonly<T> {
  if (catalog === null || typeof catalog !== 'object' || Array.isArray(catalog)) {
    throw new Error('Localisation catalog must be an object');
  }

  for (const [key, entries] of Object.entries(catalog)) {
    if (key.trim().length === 0) throw new Error('Localisation message key must be non-empty');
    if (entries === null || typeof entries !== 'object' || Array.isArray(entries)) {
      throw new Error(`Localisation message ${key} must define one entry per country`);
    }

    const missing = SUPPORTED_COUNTRIES.filter((country) => !(country in entries));
    const extra = Object.keys(entries).filter(
      (country): country is string => !(SUPPORTED_COUNTRIES as readonly string[]).includes(country),
    );
    if (missing.length > 0 || extra.length > 0) {
      const detail = [
        ...(missing.length > 0 ? [`missing countries: ${missing.join(', ')}`] : []),
        ...(extra.length > 0 ? [`unknown countries: ${extra.join(', ')}`] : []),
      ].join('; ');
      throw new Error(`Localisation message ${key} must be exhaustive (${detail})`);
    }

    const canonicalBranches = templateBranches(entries.UK);
    assertTemplate(entries.UK, `${key}.UK`);
    const canonicalNames = new Map<string, ReadonlySet<string>>(
      Object.entries(canonicalBranches).map(([branch, value]) => [branch, placeholderNames(value)]),
    );
    const canonicalUnion = new Set<string>();
    for (const names of canonicalNames.values()) for (const name of names) canonicalUnion.add(name);

    for (const country of SUPPORTED_COUNTRIES) {
      const template = entries[country];
      assertTemplate(template, `${key}.${country}`);
      const branches = templateBranches(template);
      if (isPluralTemplate(entries.UK) !== isPluralTemplate(template)) {
        throw new Error(`Localisation message ${key}.${country} does not match UK plural shape`);
      }
      for (const [branch, value] of Object.entries(branches)) {
        const expected = canonicalNames.get(branch) ?? canonicalUnion;
        assertPlaceholderParity(expected, placeholderNames(value), `${key}.${country}.${branch}`);
      }
    }
  }

  return catalog;
}

/** Return placeholders in one message template (useful to message authors/tests). */
export function messagePlaceholders(template: MessageTemplate): ReadonlySet<string> {
  const names = new Set<string>();
  for (const value of Object.values(templateBranches(template))) {
    for (const name of placeholderNames(value)) names.add(name);
  }
  return names;
}
