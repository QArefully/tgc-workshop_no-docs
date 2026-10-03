import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SUPPORTED_COUNTRIES } from '@shop/contracts/country';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForgotPasswordPage } from './ForgotPasswordPage';

const authApi = vi.hoisted(() => ({
  forgotPassword: vi.fn(),
}));

vi.mock('@/api/auth', () => authApi);

// Guest default: a returning buyer on a fresh browser carries 'US' from context.
vi.mock('@/hooks/CountryContext', () => ({
  useCountry: () => ({ activeCountry: 'US' as const }),
}));

function renderPage() {
  return render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      initialEntries={['/forgot-password']}
    >
      <ForgotPasswordPage />
    </MemoryRouter>,
  );
}

describe('ForgotPasswordPage country selection', () => {
  beforeEach(() => {
    authApi.forgotPassword.mockReset().mockResolvedValue({ success: true });
  });

  it('renders a country select listing every supported country, defaulted to the active country', () => {
    renderPage();

    const select = screen.getByLabelText<HTMLSelectElement>('Country');
    expect(select.value).toBe('US');
    expect([...select.options].map((o) => o.value)).toEqual([...SUPPORTED_COUNTRIES]);
  });

  it('submits the selected country rather than the guest default', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('Email'), 'buyer@example.test');
    await user.selectOptions(screen.getByLabelText('Country'), 'UK');
    await user.click(screen.getByRole('button', { name: 'Send Reset Link' }));

    expect(authApi.forgotPassword).toHaveBeenCalledWith({
      email: 'buyer@example.test',
      country: 'UK',
    });
    expect(await screen.findByRole('heading', { name: 'Check Your Email' })).toBeInTheDocument();
  });
});
