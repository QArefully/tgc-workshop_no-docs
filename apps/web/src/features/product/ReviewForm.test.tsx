import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CountryProvider, useCountry } from '@/hooks/CountryContext';
import { LocaleProvider } from '@/i18n/LocaleContext';
import type { CountryStorage } from '@/lib/countryStorage';
import { describe, expect, it, vi } from 'vitest';
import { ReviewForm } from './ReviewForm';

const storage: CountryStorage = {
  getItem: () => 'UK',
  setItem: () => undefined,
  removeItem: () => undefined,
};

function CountrySwitcher() {
  const { selectCountry } = useCountry();
  return (
    <button type="button" onClick={() => selectCountry('DE')}>
      DE
    </button>
  );
}

describe('ReviewForm', () => {
  it('blocks short text before sending and preserves text after a mutation failure', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(false);
    render(
      <ReviewForm
        review={null}
        isPending={false}
        error="Could not save your review."
        onSubmit={onSubmit}
        onDelete={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Publish review' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('20 to 4,000');

    await user.type(screen.getByLabelText('Review'), 'This is a sufficiently detailed review.');
    await user.click(screen.getByRole('button', { name: 'Publish review' }));
    expect(onSubmit).toHaveBeenCalledWith({
      rating: 5,
      body: 'This is a sufficiently detailed review.',
    });
    expect(screen.getByLabelText('Review')).toHaveValue('This is a sufficiently detailed review.');
  });

  it('marks the selected rating through the radio peer', async () => {
    const user = userEvent.setup();
    render(
      <ReviewForm
        review={null}
        isPending={false}
        error={null}
        onSubmit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const rating = screen.getByRole('radio', { name: '3' });
    await user.click(rating);
    expect(rating).toBeChecked();
    expect(rating.nextElementSibling).toHaveClass('peer-checked:border-primary');
  });

  it('re-renders retained validation copy after a country switch', async () => {
    const user = userEvent.setup();
    render(
      <CountryProvider storage={storage}>
        <LocaleProvider>
          <ReviewForm
            review={null}
            isPending={false}
            error={null}
            onSubmit={vi.fn()}
            onDelete={vi.fn()}
          />
          <CountrySwitcher />
        </LocaleProvider>
      </CountryProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Publish review' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Review text must be 20 to 4,000 characters.',
    );

    await user.click(screen.getByRole('button', { name: 'DE' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Der Bewertungstext muss 20 bis 4.000 Zeichen enthalten.',
    );
  });
});
