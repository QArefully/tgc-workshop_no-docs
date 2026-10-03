import { createContext, useContext, useLayoutEffect, useMemo, type ReactNode } from 'react';
import {
  formatCivilDate,
  formatCount,
  formatDecimal,
  formatDisplayMoney,
  formatDualTotal,
  formatInstant,
  formatNumber,
  formatSettlementMoney,
  formatWeight,
  formatWeightGrams,
  translateUnchecked,
  type DateFormatOptions,
  type DatePreset,
  type MessageCatalog,
  type MessageParams,
  type NumberPreset,
  type DualTotal,
} from '@shop/localisation';
import { DEFAULT_GUEST_COUNTRY, SUPPORTED_COUNTRIES, type Country } from '@shop/contracts/country';
import { countryProfile, type CountryProfile } from '@shop/contracts/country-profiles';
import { useCountry } from '@/hooks/CountryContext';

export interface LocalisationValue {
  /** Selected identity country remains the sole locale state authority. */
  readonly country: Country;
  readonly activeCountry: Country;
  readonly profile: CountryProfile;
  readonly translate: (catalog: MessageCatalog, key: string, params?: MessageParams) => string;
  readonly t: LocalisationValue['translate'];
  readonly formatDisplayMoney: (pence: number) => string;
  readonly formatMoney: (pence: number) => string;
  readonly formatSettlementMoney: (pence: number) => string;
  readonly formatDualTotal: (pence: number) => DualTotal;
  readonly formatInstant: (
    value: Date | string | number,
    preset?: DatePreset | DateFormatOptions,
  ) => string;
  readonly formatCivilDate: (value: string, preset?: DatePreset | DateFormatOptions) => string;
  readonly formatDate: (value: string, preset?: DatePreset | DateFormatOptions) => string;
  readonly formatNumber: (value: number, preset?: NumberPreset) => string;
  readonly formatDecimal: (value: number) => string;
  readonly formatCount: (value: number) => string;
  readonly formatWeight: (value: number, unit?: string) => string;
  readonly formatWeightGrams: (value: number) => string;
  /** Semantic groups keep feature code discoverable while preserving direct helpers above. */
  readonly money: {
    readonly display: (pence: number) => string;
    readonly settlement: (pence: number) => string;
    readonly dual: (pence: number) => DualTotal;
  };
  readonly date: {
    readonly instant: LocalisationValue['formatInstant'];
    readonly civil: LocalisationValue['formatCivilDate'];
  };
  readonly number: {
    readonly format: LocalisationValue['formatNumber'];
    readonly decimal: LocalisationValue['formatDecimal'];
    readonly count: LocalisationValue['formatCount'];
    readonly weight: LocalisationValue['formatWeight'];
    readonly weightGrams: LocalisationValue['formatWeightGrams'];
  };
}

export const LocaleContext = createContext<LocalisationValue | null>(null);

function isSupportedCountry(value: unknown): value is Country {
  return typeof value === 'string' && (SUPPORTED_COUNTRIES as readonly string[]).includes(value);
}

/** Keep provider-free isolated tests deterministic while rejecting malformed runtime state. */
function resolveCountry(value: unknown): Country {
  return isSupportedCountry(value) ? value : DEFAULT_GUEST_COUNTRY;
}

function createLocalisation(country: Country): LocalisationValue {
  const profile = countryProfile(country);
  const translate = (catalog: MessageCatalog, key: string, params: MessageParams = {}) =>
    translateUnchecked(catalog, country, key, params);
  const display = (pence: number) => formatDisplayMoney(pence, profile);
  const settlement = (pence: number) => formatSettlementMoney(pence);
  const dual = (pence: number) => formatDualTotal(pence, profile);
  const instant = (value: Date | string | number, preset?: DatePreset | DateFormatOptions) =>
    formatInstant(value, profile, preset);
  const civil = (value: string, preset?: DatePreset | DateFormatOptions) =>
    formatCivilDate(value, profile, preset);
  const number = (value: number, preset: NumberPreset = 'decimal') =>
    formatNumber(value, profile, preset);
  const decimal = (value: number) => formatDecimal(value, profile);
  const count = (value: number) => formatCount(value, profile);
  const weight = (value: number, unit = 'g') => formatWeight(value, profile, unit);
  const weightGrams = (value: number) => formatWeightGrams(value, profile);

  return {
    country,
    activeCountry: country,
    profile,
    translate,
    t: translate,
    formatDisplayMoney: display,
    formatMoney: display,
    formatSettlementMoney: settlement,
    formatDualTotal: dual,
    formatInstant: instant,
    formatCivilDate: civil,
    formatDate: civil,
    formatNumber: number,
    formatDecimal: decimal,
    formatCount: count,
    formatWeight: weight,
    formatWeightGrams: weightGrams,
    money: { display, settlement, dual },
    date: { instant, civil },
    number: { format: number, decimal, count, weight, weightGrams },
  };
}

/**
 * Binds translated copy and locale-aware formatters to CountryProvider's active country.
 * The layout mounts this directly inside CountryProvider; no second storage or locale state is
 * introduced here.
 */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const { activeCountry } = useCountry();
  const country = resolveCountry(activeCountry);
  const value = useMemo(() => createLocalisation(country), [country]);

  useLayoutEffect(() => {
    const previous = document.documentElement.lang;
    document.documentElement.lang = value.profile.language;
    return () => {
      document.documentElement.lang = previous;
    };
  }, [value.profile.language]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/**
 * Read the active country-bound adapter. Components rendered in isolation intentionally fall back
 * to the guest US country, matching CountryContext's own optional-provider contract.
 */
export function useLocalisation(): LocalisationValue {
  const context = useContext(LocaleContext);
  // Provider-free consumers intentionally default to the guest US country. Runtime consumers
  // inside Layout receive the active country through LocaleProvider; no component may override
  // the provider's country with a second locale source.
  const fallback = useMemo(() => createLocalisation(DEFAULT_GUEST_COUNTRY), []);
  return context ?? fallback;
}

/** US spelling retained as a small compatibility alias for feature consumers. */
export const useLocalization = useLocalisation;
export const useLocale = useLocalisation;

/** Resolve one typed or dynamic feature bundle at render time. */
export function useMessages<C extends MessageCatalog>(catalog: C) {
  const { translate } = useLocalisation();
  return useMemo(
    () =>
      <K extends keyof C & string>(key: K, params?: MessageParams) =>
        translate(catalog, key, params),
    [catalog, translate],
  );
}
