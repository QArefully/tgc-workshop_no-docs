import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CountryBanner } from './CountryBanner';
import { LocaleProvider } from '@/i18n/LocaleContext';

const countryState: { activeCountry: string | undefined } = vi.hoisted(() => ({
  activeCountry: 'ES',
}));

vi.mock('@/hooks/CountryContext', () => ({
  useCountry: () => ({
    activeCountry: countryState.activeCountry,
    isAccountBound: false,
    selectCountry: vi.fn(),
    countryStorage: null,
  }),
}));

describe('CountryBanner', () => {
  it('renders the active profile banner with the established promotion treatment', () => {
    countryState.activeCountry = 'ES';
    render(
      <LocaleProvider>
        <CountryBanner />
      </LocaleProvider>,
    );

    const notice = screen.getByRole('region', { name: 'Aviso de pedidos por país' });
    expect(notice).toHaveTextContent(
      'Pedidos para España: la disponibilidad y las opciones de entrega reflejan los requisitos locales.',
    );
    expect(notice).toHaveClass(
      'overflow-hidden',
      'rounded-2xl',
      'border-2',
      'border-foreground',
      'bg-sale',
      'text-sale-foreground',
    );
  });

  it('renders no element when the active profile has no banner', () => {
    countryState.activeCountry = 'UK';
    const { container } = render(
      <LocaleProvider>
        <CountryBanner />
      </LocaleProvider>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('renders no element when the active country is unsupported or absent', () => {
    for (const activeCountry of ['ZZ', undefined]) {
      countryState.activeCountry = activeCountry;
      const { container, unmount } = render(
        <LocaleProvider>
          <CountryBanner />
        </LocaleProvider>,
      );

      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
});
