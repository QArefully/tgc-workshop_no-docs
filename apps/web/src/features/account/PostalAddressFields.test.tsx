import { render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import type { Country } from '@shop/contracts/country';
import { translateUnchecked } from '@shop/localisation';
import { countryMessages } from '@shop/localisation/messages/country';
import { identityAccountMessages } from '@shop/localisation/messages/identityAccount';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOptionalCountry } from '@/hooks/CountryContext';
import {
  PostalAddressFields,
  emptyPostalAddressDraft,
  validatePostalAddressDraft,
  type PostalAddressDraft,
} from './PostalAddressFields';

vi.mock('@/hooks/CountryContext', () => ({ useOptionalCountry: vi.fn() }));

const storage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

function validDraft(country: Country, postcode: string): PostalAddressDraft {
  return {
    ...emptyPostalAddressDraft(country),
    line1: '1 Test Street',
    city: 'Testville',
    postcode,
  };
}

function AddressHarness({ initialCountry }: { initialCountry: Country }) {
  const [draft, setDraft] = useState(() => emptyPostalAddressDraft(initialCountry));
  return (
    <PostalAddressFields
      idPrefix="test-address"
      value={draft}
      onChange={setDraft}
      errors={{ postcode: 'Postcode error' }}
    />
  );
}

describe('PostalAddressFields', () => {
  beforeEach(() => {
    vi.mocked(useOptionalCountry).mockReturnValue({
      activeCountry: 'UK',
      isAccountBound: true,
      selectCountry: vi.fn(),
      countryStorage: storage,
    });
  });

  it.each([
    ['UK', 'SW1A 1AA', '10115'],
    ['US', '10001', '1000'],
    ['CN', '100000', '10000'],
    ['PL', '00-001', '00001'],
    ['ES', '28013', '2801'],
    ['DE', '10115', '1011'],
    ['FR', '75001', '7500'],
  ] as const)('applies the %s postcode profile', (country, accepted, rejected) => {
    expect(validatePostalAddressDraft(validDraft(country, accepted))).toMatchObject({ ok: true });
    const result = validatePostalAddressDraft(validDraft(country, rejected));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected postcode validation to fail');
    expect(typeof result.errors.postcode).toBe('string');
  });

  it('keeps the established UK checkout postcode valid', () => {
    expect(validatePostalAddressDraft(validDraft('UK', 'TE1 1ST'))).toMatchObject({ ok: true });
    expect(validatePostalAddressDraft(validDraft('UK', 'te1 1st'))).toMatchObject({ ok: true });
  });

  it('renders the active profile label and example and defaults its first delivery country code', async () => {
    vi.mocked(useOptionalCountry).mockReturnValue({
      activeCountry: 'DE',
      isAccountBound: true,
      selectCountry: vi.fn(),
      countryStorage: storage,
    });

    render(<AddressHarness initialCountry="UK" />);

    expect(screen.getByLabelText('Postleitzahl')).toHaveAttribute('placeholder', '10115');
    await waitFor(() =>
      expect(
        screen.getByLabelText(
          translateUnchecked(identityAccountMessages, 'DE', 'account.address.countryCode'),
        ),
      ).toHaveValue('DE'),
    );
  });

  it.each([
    ['UK', 'Postcode'],
    ['US', 'ZIP code'],
    ['CN', '邮政编码'],
    ['PL', 'Kod pocztowy'],
    ['ES', 'Código postal'],
    ['DE', 'Postleitzahl'],
    ['FR', 'Code postal'],
  ] as const)(
    'renders the %s postcode label from the country catalog',
    (country, expectedLabel) => {
      vi.mocked(useOptionalCountry).mockReturnValue({
        activeCountry: country,
        isAccountBound: true,
        selectCountry: vi.fn(),
        countryStorage: storage,
      });

      render(<AddressHarness initialCountry={country} />);

      expect(translateUnchecked(countryMessages, country, 'postcode.label')).toBe(expectedLabel);
      expect(screen.getByLabelText(expectedLabel)).toBeInTheDocument();
    },
  );

  it('preserves postcode error accessibility wiring', () => {
    render(<AddressHarness initialCountry="UK" />);

    const postcode = screen.getByLabelText('Postcode');
    expect(postcode).toHaveAttribute('aria-invalid', 'true');
    expect(postcode).toHaveAttribute('aria-describedby', 'test-address-postcode-error');
    expect(screen.getByRole('alert')).toHaveAttribute('id', 'test-address-postcode-error');
  });
});
