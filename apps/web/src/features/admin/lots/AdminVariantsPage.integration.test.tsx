import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Country } from '@shop/contracts/country';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/i18n/LocaleContext';
import { AdminVariantsPage } from './AdminVariantsPage';

const countryState: { activeCountry: Country } = vi.hoisted(() => ({ activeCountry: 'DE' }));
vi.mock('@/hooks/CountryContext', () => ({
  useCountry: () => ({
    activeCountry: countryState.activeCountry,
    isAccountBound: false,
    selectCountry: vi.fn(),
    countryStorage: null,
  }),
}));

function inputValue(element: HTMLElement): string {
  if (!(element instanceof HTMLInputElement)) throw new Error('Expected input element');
  return element.value;
}

const api = vi.hoisted(() => ({
  getAdminProductVariants: vi.fn(),
  createAdminVariant: vi.fn(),
  updateAdminVariant: vi.fn(),
  retireAdminVariant: vi.fn(),
  setAdminVariantClearance: vi.fn(),
}));
vi.mock('@/api/adminVariants', () => api);
const variant = {
  id: '2',
  productId: '1',
  sku: 'CEM-25',
  label: '25kg sack',
  weightGrams: 25000,
  priceCents: 900,
  moqSacks: 1,
  compareAtPriceCents: null,
  clearance: null,
  stockCount: 3,
  backorderable: false,
  backorderLeadDays: null,
  deliveryClass: 'freight' as const,
  active: true,
  sortOrder: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
describe('AdminVariantsPage', () => {
  afterEach(() => {
    countryState.activeCountry = 'DE';
    vi.resetAllMocks();
  });

  function renderPage() {
    return render(
      <LocaleProvider>
        <AdminVariantsPage />
      </LocaleProvider>,
    );
  }

  it('saves clearance through the API', async () => {
    api.getAdminProductVariants.mockResolvedValue({ items: [variant] });
    api.setAdminVariantClearance.mockResolvedValue({
      ...variant,
      clearance: {
        priceCents: 800,
        startsAt: '2026-01-01T00:00:00.000Z',
        endsAt: '2026-01-02T00:00:00.000Z',
      },
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /25kg sack/ }));
    expect(screen.getByLabelText('Preis (GBP-Pence)')).toHaveValue(900);
    await user.click(screen.getByLabelText('Abverkauf aktivieren'));
    expect(inputValue(screen.getByLabelText('Beginnt am'))).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/,
    );
    await user.click(screen.getByRole('button', { name: 'Abverkauf speichern' }));
    await waitFor(() => expect(api.setAdminVariantClearance).toHaveBeenCalled());
    // Enabling clearance seeds the window from the lot's own price and the next 24 hours; the
    // contract rejects a partial clearance, so the page must submit all three fields as instants.
    const [id, body] = api.setAdminVariantClearance.mock.calls[0] as [
      string,
      { clearance: { priceCents: number; startsAt: string; endsAt: string } },
    ];
    expect(id).toBe('2');
    expect(body.clearance.priceCents).toBe(variant.priceCents);
    expect(body.clearance.startsAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(body.clearance.endsAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Date.parse(body.clearance.endsAt) - Date.parse(body.clearance.startsAt)).toBe(86400000);
  });
  it('shows retirement rejection', async () => {
    api.getAdminProductVariants.mockResolvedValue({ items: [variant] });
    api.retireAdminVariant.mockRejectedValue(new Error('Lot has order references'));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /25kg sack/ }));
    await user.click(screen.getByRole('button', { name: 'Charge ausmustern' }));
    await user.click(screen.getByRole('button', { name: 'Ausmustern bestätigen' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Anfrage fehlgeschlagen.');
    expect(screen.queryByText('Lot has order references')).not.toBeInTheDocument();
  });

  it('keeps datetime-local display at the minute boundary and writes an instant', async () => {
    const datedVariant = {
      ...variant,
      clearance: {
        priceCents: 800,
        startsAt: '2026-01-01T12:34:56.789Z',
        endsAt: '2026-01-02T12:34:56.789Z',
      },
    };
    api.getAdminProductVariants.mockResolvedValue({ items: [datedVariant] });
    api.setAdminVariantClearance.mockResolvedValue(datedVariant);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /25kg sack/ }));
    expect(screen.getByLabelText('Beginnt am')).toHaveValue('2026-01-01T12:34');
    expect(screen.getByLabelText('Endet am')).toHaveValue('2026-01-02T12:34');
    await user.click(screen.getByRole('button', { name: 'Abverkauf speichern' }));
    await waitFor(() => expect(api.setAdminVariantClearance).toHaveBeenCalled());
    const [, body] = api.setAdminVariantClearance.mock.calls[0] as [
      string,
      { clearance: { startsAt: string; endsAt: string } },
    ];
    expect(body.clearance.startsAt).toBe('2026-01-01T12:34:56.789Z');
    expect(body.clearance.endsAt).toBe('2026-01-02T12:34:56.789Z');
  });
});
