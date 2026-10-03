import { render, screen } from '@testing-library/react';
import type { Country } from '@shop/contracts/country';
import { describe, expect, it, vi } from 'vitest';
import { LocaleProvider, useLocalisation } from './LocaleContext';
import { webMessages } from '@shop/localisation/messages/webShell';

const countryState: { activeCountry: Country } = vi.hoisted(() => ({ activeCountry: 'US' }));

vi.mock('@/hooks/CountryContext', () => ({
  useCountry: () => ({ activeCountry: countryState.activeCountry }),
  useOptionalCountry: () => ({ activeCountry: countryState.activeCountry }),
}));

function Probe() {
  const locale = useLocalisation();
  return (
    <output>
      {locale.country}|{locale.profile.numberLocale}|{locale.formatDisplayMoney(1234)}|
      {locale.translate(webMessages, 'shell.searchProducts')}
    </output>
  );
}

describe('LocaleProvider', () => {
  it('refreshes profile, copy, money, and html language for US/DE/ES switches', () => {
    countryState.activeCountry = 'US';
    const view = render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );

    expect(screen.getByText('US|en-US|$15.43|Search products')).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('en');

    countryState.activeCountry = 'DE';
    view.rerender(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByText(/DE\|de-DE\|14,44\s€\|Produkte suchen/)).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('de');

    countryState.activeCountry = 'ES';
    view.rerender(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByText(/ES\|es-ES\|14,44\s€\|Buscar productos/)).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('es');
  });

  it('defaults isolated consumers to US without a provider', () => {
    countryState.activeCountry = 'US';
    render(<Probe />);
    expect(screen.getByText(/US\|en-US\|\$15\.43\|Search products/)).toBeInTheDocument();
  });
});
