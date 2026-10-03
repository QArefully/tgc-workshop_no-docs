import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '@/App';

vi.mock('@/components/Layout', async () => {
  const { Outlet } = await import('react-router-dom');

  return {
    Layout: () => <Outlet />,
  };
});

function renderApp(initialEntry: string) {
  return render(
    <MemoryRouter
      initialEntries={[initialEntry]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <App />
    </MemoryRouter>,
  );
}

describe('help journey', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('navigates from Help center to FAQ without a help API request', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    renderApp('/help');

    await user.click(screen.getByRole('link', { name: 'Frequently asked questions' }));

    expect(
      await screen.findByRole('heading', { name: 'Frequently asked questions', level: 1 }),
    ).toBeVisible();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('renders a privacy policy direct deep link without a help API request', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    renderApp('/policies/privacy');

    expect(await screen.findByRole('heading', { name: 'Privacy', level: 1 })).toBeVisible();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(['/help/not-a-topic', '/policies/not-a-policy'])(
    'renders the shared 404 page for an unknown article route: %s',
    async (path) => {
      renderApp(path);

      expect(
        await screen.findByRole('heading', { name: 'Page not found', level: 2 }),
      ).toBeVisible();
    },
  );
});
