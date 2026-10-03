import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Country } from '@shop/contracts/country';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/i18n/LocaleContext';
import { AdminPromosPage } from './AdminPromosPage';
const api = vi.hoisted(() => ({
  getAdminPromos: vi.fn(),
  createAdminPromo: vi.fn(),
  updateAdminPromo: vi.fn(),
  deactivateAdminPromo: vi.fn(),
}));
vi.mock('@/api/adminPromos', () => api);
const countryState: { activeCountry: Country } = vi.hoisted(() => ({ activeCountry: 'DE' }));
vi.mock('@/hooks/CountryContext', () => ({
  useCountry: () => ({
    activeCountry: countryState.activeCountry,
    isAccountBound: false,
    selectCountry: vi.fn(),
    countryStorage: null,
  }),
}));
const promo = {
  code: 'TRADE10',
  active: true,
  redemptionCount: 0,
  discountPercent: 10,
  minItemCount: 0,
  kind: 'percent' as const,
  amountCents: null,
  minSubtotalCents: null,
  categoryScope: null,
  startAt: null,
  endAt: null,
  maxRedemptions: null,
  perUserLimit: null,
  countries: ['UK', 'DE'] as const,
};
describe('AdminPromosPage', () => {
  beforeEach(() => {
    countryState.activeCountry = 'DE';
  });
  afterEach(() => vi.resetAllMocks());

  function renderPage() {
    return render(
      <LocaleProvider>
        <AdminPromosPage />
      </LocaleProvider>,
    );
  }

  it('creates a promotion through the typed client', async () => {
    api.getAdminPromos.mockResolvedValue({ items: [promo] });
    api.createAdminPromo.mockResolvedValue({ ...promo, code: 'NEW10' });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('TRADE10');
    await user.click(screen.getByRole('button', { name: 'Neue Aktion' }));
    await user.type(screen.getByLabelText('Code'), 'new10');
    await user.clear(screen.getByLabelText('Rabatt in Prozent'));
    await user.type(screen.getByLabelText('Rabatt in Prozent'), '10');
    await user.click(screen.getByRole('button', { name: 'Aktion speichern' }));
    await waitFor(() =>
      expect(api.createAdminPromo).toHaveBeenCalledWith(expect.objectContaining({ code: 'NEW10' })),
    );
  });
  it('shows a deactivation failure', async () => {
    api.getAdminPromos.mockResolvedValue({ items: [promo] });
    api.deactivateAdminPromo.mockRejectedValue(new Error('Promotion already redeemed'));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'TRADE10 Aktiv' }));
    await user.click(screen.getByRole('button', { name: 'Aktion deaktivieren' }));
    await user.click(screen.getByRole('button', { name: 'Deaktivierung bestätigen' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Anfrage fehlgeschlagen.');
    expect(screen.queryByText('Promotion already redeemed')).not.toBeInTheDocument();
  });
  it('serialises only update fields when editing a promotion', async () => {
    api.getAdminPromos.mockResolvedValue({ items: [promo] });
    api.updateAdminPromo.mockResolvedValue(promo);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'TRADE10 Aktiv' }));
    await user.selectOptions(screen.getByLabelText('Kategorieumfang'), 'Drinks');
    await user.clear(screen.getByLabelText('Maximale Einlösungen'));
    await user.type(screen.getByLabelText('Maximale Einlösungen'), '20');
    await user.click(screen.getByRole('button', { name: 'Aktion speichern' }));
    await waitFor(() =>
      expect(api.updateAdminPromo).toHaveBeenCalledWith(
        'TRADE10',
        expect.objectContaining({
          categoryScope: 'Drinks',
          maxRedemptions: 20,
          countries: ['UK', 'DE'],
        }),
      ),
    );
    const updateCall = api.updateAdminPromo.mock.calls[0] as unknown;
    if (!updateCall) throw new Error('Expected promotion update request.');
    if (!Array.isArray(updateCall)) throw new Error('Expected promotion update arguments.');
    const [, update] = updateCall as [unknown, unknown];
    expect(update).not.toHaveProperty('code');
    expect(update).not.toHaveProperty('active');
    expect(update).not.toHaveProperty('redemptionCount');
  });

  it('refetches the server-scoped list when the standing country changes', async () => {
    api.getAdminPromos.mockResolvedValue({ items: [promo] });
    const { rerender } = renderPage();
    await screen.findByText('TRADE10');
    expect(api.getAdminPromos).toHaveBeenCalledTimes(1);

    countryState.activeCountry = 'UK';
    rerender(
      <LocaleProvider>
        <AdminPromosPage />
      </LocaleProvider>,
    );
    await waitFor(() => expect(api.getAdminPromos).toHaveBeenCalledTimes(2));
  });

  it('labels an empty targeting selection as applying to all countries', async () => {
    api.getAdminPromos.mockResolvedValue({ items: [promo] });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'TRADE10 Aktiv' }));

    expect(screen.getByLabelText('Länderzielgruppe')).toHaveValue(['UK', 'DE']);

    await user.click(screen.getByRole('button', { name: 'Neue Aktion' }));
    expect(screen.getByLabelText('Länderzielgruppe')).toHaveValue([]);
    expect(screen.getByText('Leer lassen, um alle Länder einzuschließen.')).toBeInTheDocument();
  });

  it('keeps raw targeting values, GBP pence input, and datetime-local minute display', async () => {
    const datedPromo = {
      ...promo,
      amountCents: 750,
      startAt: '2026-01-01T12:34:56.789Z',
      endAt: '2026-01-02T12:34:56.789Z',
    };
    api.getAdminPromos.mockResolvedValue({ items: [datedPromo] });
    api.updateAdminPromo.mockResolvedValue(datedPromo);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'TRADE10 Aktiv' }));
    expect(screen.getByLabelText('Länderzielgruppe')).toHaveValue(['UK', 'DE']);
    expect(screen.getByLabelText('Fester Betrag (GBP-Pence)')).toHaveValue(750);
    expect(screen.getByLabelText('Beginnt am')).toHaveValue('2026-01-01T12:34');
    expect(screen.getByLabelText('Endet am')).toHaveValue('2026-01-02T12:34');
    await user.click(screen.getByRole('button', { name: 'Aktion speichern' }));
    await waitFor(() => expect(api.updateAdminPromo).toHaveBeenCalled());
    expect(api.updateAdminPromo).toHaveBeenCalledWith(
      'TRADE10',
      expect.objectContaining({ countries: ['UK', 'DE'], amountCents: 750 }),
    );
  });
});
