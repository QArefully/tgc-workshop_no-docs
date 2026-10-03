import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { DEFAULT_GUEST_COUNTRY, type Country } from '@shop/contracts/country';
import { setActiveApiCountry } from '@/api/client';
import { useAuth } from '@/hooks/AuthContext';
import {
  browserStorage,
  readSelectedCountry,
  writeSelectedCountry,
  type CountryStorage,
} from '@/lib/countryStorage';

export interface CountryContextValue {
  activeCountry: Country;
  isAccountBound: boolean;
  selectCountry: (country: Country) => void;
  countryStorage: CountryStorage | null;
}

const CountryContext = createContext<CountryContextValue | null>(null);

export function CountryProvider({
  children,
  storage,
}: {
  children: ReactNode;
  storage?: CountryStorage | null;
}) {
  const resolvedStorage = storage === undefined ? browserStorage() : storage;
  const { user } = useAuth();
  const [guestCountry, setGuestCountry] = useState<Country>(() =>
    readSelectedCountry(resolvedStorage),
  );

  const isAccountBound = user !== null && user.role !== 'admin';
  const activeCountry = isAccountBound ? user.country : guestCountry;

  useLayoutEffect(() => {
    setActiveApiCountry(activeCountry);
    return () => setActiveApiCountry(null);
  }, [activeCountry]);

  const selectCountry = useCallback(
    (country: Country) => {
      if (isAccountBound) return;
      writeSelectedCountry(resolvedStorage, country);
      setGuestCountry(country);
    },
    [isAccountBound, resolvedStorage],
  );

  const value = useMemo<CountryContextValue>(
    () => ({
      activeCountry,
      isAccountBound,
      selectCountry,
      countryStorage: resolvedStorage,
    }),
    [activeCountry, isAccountBound, selectCountry, resolvedStorage],
  );

  return <CountryContext.Provider value={value}>{children}</CountryContext.Provider>;
}

export function useCountry(): CountryContextValue {
  const context = useContext(CountryContext);
  if (!context) throw new Error('useCountry must be used within CountryProvider');
  return context;
}

export function useOptionalCountry(): CountryContextValue {
  const context = useContext(CountryContext);
  if (context) return context;
  return {
    activeCountry: DEFAULT_GUEST_COUNTRY,
    isAccountBound: false,
    selectCountry: () => {},
    countryStorage: null,
  };
}
