import type { ChangeEvent } from 'react';
import { SUPPORTED_COUNTRIES, type Country } from '@shop/contracts/country';
import { useLocalisation } from '@/i18n/LocaleContext';
import { webMessages } from '@shop/localisation/messages/webShell';
import { countryMessages } from '@shop/localisation/messages/country';

interface CountryPickerProps {
  value: Country;
  onChange: (country: Country) => void;
  disabled?: boolean;
}

export function CountryPicker({ value, onChange, disabled }: CountryPickerProps) {
  const { translate } = useLocalisation();
  const label = disabled
    ? translate(webMessages, 'country.accountCountry')
    : translate(webMessages, 'country.country');
  const accountBoundExplanation = translate(webMessages, 'country.accountBoundExplanation');
  const countryName = (country: Country) =>
    translate(
      countryMessages,
      `country.name.${country.toLowerCase()}` as keyof typeof countryMessages,
    );
  function handleChange(e: ChangeEvent<HTMLSelectElement>) {
    onChange(e.target.value as Country);
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="country-picker" className="flex items-center gap-2 text-sm font-medium">
        <span className="hidden text-muted-foreground sm:inline">{label}</span>
        <select
          id="country-picker"
          data-testid="country-picker"
          aria-label={label}
          aria-describedby={disabled ? 'country-picker-account-note' : undefined}
          title={disabled ? accountBoundExplanation : undefined}
          value={value}
          onChange={handleChange}
          disabled={disabled}
          className="h-10 max-w-44 rounded-lg border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:border-muted disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
        >
          {SUPPORTED_COUNTRIES.map((c) => (
            <option key={c} value={c}>
              {countryName(c)}
            </option>
          ))}
        </select>
      </label>
      {disabled && (
        <p
          id="country-picker-account-note"
          data-testid="country-picker-account-note"
          className="max-w-52 whitespace-normal text-xs text-muted-foreground"
        >
          {accountBoundExplanation}
        </p>
      )}
    </div>
  );
}
