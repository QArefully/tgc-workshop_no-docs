import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { HelpArticlePage } from './HelpArticlePage';
import { HelpIndexPage } from './HelpIndexPage';

function renderHelpRoute(initialEntry: string) {
  return render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      initialEntries={[initialEntry]}
    >
      <Routes>
        <Route path="/help" element={<HelpIndexPage />} />
        <Route path="/help/:slug" element={<HelpArticlePage group="help" />} />
        <Route path="/policies/:slug" element={<HelpArticlePage group="policy" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Help pages', () => {
  it('renders a grouped, linked help index with semantic sections and lists', () => {
    renderHelpRoute('/help');

    expect(screen.getByRole('heading', { level: 1, name: 'Help center' })).toBeInTheDocument();

    const helpTopics = screen.getByRole('heading', { level: 2, name: 'Help topics' });
    const policyTopics = screen.getByRole('heading', { level: 2, name: 'Demo policies' });
    expect(helpTopics).toBeInTheDocument();
    expect(policyTopics).toBeInTheDocument();

    const helpSection = helpTopics.closest('section');
    const policySection = policyTopics.closest('section');
    expect(helpSection).not.toBeNull();
    expect(policySection).not.toBeNull();

    expect(within(helpSection as HTMLElement).getByRole('list')).toBeInTheDocument();
    expect(within(policySection as HTMLElement).getByRole('list')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Frequently asked questions' })).toHaveAttribute(
      'href',
      '/help/faq',
    );
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute(
      'href',
      '/policies/privacy',
    );
  });

  it('renders articles through shared heading, list, and notice semantics', () => {
    renderHelpRoute('/help/shipping');

    expect(screen.getByRole('article', { name: 'Shipping' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Shipping' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'No real delivery service' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('note', { name: 'No real delivery service' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Simulated tracking' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Tracking references and timeline updates are simulated local-demo data only/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Help center' })).toHaveAttribute(
      'href',
      '/help',
    );
  });

  it('renders updated returns article with simulated workflow content', () => {
    renderHelpRoute('/help/returns');

    expect(screen.getByRole('article', { name: 'Returns' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Returns' })).toBeInTheDocument();
    // Simulated-only notice
    expect(
      screen.getByRole('note', { name: 'Simulated only — no real returns or payments' }),
    ).toBeInTheDocument();
    // Eligibility section
    expect(screen.getByRole('heading', { level: 2, name: 'Eligibility' })).toBeInTheDocument();
    expect(screen.getByText(/30 days/)).toBeInTheDocument();
    expect(
      screen.getByText(/Custom Blend lines are made to order and are excluded/),
    ).toBeInTheDocument();
    // Exclusion from returns must not be read as an order that can no longer be cancelled.
    expect(
      screen.getByText(/cancels on exactly the same terms as any other order/),
    ).toBeInTheDocument();
    // Workflow section
    expect(screen.getByRole('heading', { level: 2, name: 'How it works' })).toBeInTheDocument();
    expect(screen.getByText(/demo administrator/)).toBeInTheDocument();
    // Cancellation distinction
    expect(
      screen.getByRole('heading', { level: 2, name: 'Returns vs cancellation' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Cancellation stops simulated fulfilment/)).toBeInTheDocument();
  });

  it('documents Custom Blend configuration, fee, stock asymmetry, cancellation, and returns', () => {
    renderHelpRoute('/help/custom-blend');

    expect(screen.getByRole('article', { name: 'Custom Blend' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Custom Blend' })).toBeInTheDocument();

    // How to configure: base choice plus the ratio limits the configurator enforces.
    expect(
      screen.getByRole('heading', { level: 2, name: 'Configuring a blend' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/one and four ingredients/)).toBeInTheDocument();
    expect(screen.getByText(/5% to 50%/)).toBeInTheDocument();
    expect(screen.getByText(/no more than 50% together/)).toBeInTheDocument();

    // Flat fee, stated as a per-line charge and tied to the pricing contract value.
    expect(screen.getByRole('heading', { level: 2, name: 'Blending fee' })).toBeInTheDocument();
    expect(screen.getByText(/flat blending fee of \$31\.25/)).toBeInTheDocument();
    expect(screen.getByText(/per line rather than per sack/)).toBeInTheDocument();

    // Ingredient stock asymmetry: sold-out ingredients stay selectable, the base does not.
    expect(
      screen.getByRole('heading', { level: 2, name: 'Ingredient availability' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/out of stock is still selectable/)).toBeInTheDocument();
    expect(screen.getByText(/The base material behaves differently/)).toBeInTheDocument();

    // Cancellation and non-returnability are stated as separate rules, not one combined finality.
    expect(
      screen.getByRole('note', { name: 'Cancellation and returns work differently' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/cancelled on the ordinary terms, at any point up to dispatch/),
    ).toBeInTheDocument();
    expect(screen.getByText(/never eligible for return/)).toBeInTheDocument();
  });

  it('lists Custom Blend on the help index', () => {
    renderHelpRoute('/help');

    expect(screen.getByRole('link', { name: 'Custom Blend' })).toHaveAttribute(
      'href',
      '/help/custom-blend',
    );
  });

  it('uses Materials Exchange branding in product safety guidance', () => {
    renderHelpRoute('/help/powder-safety');

    expect(screen.getByRole('article', { name: 'Product safety' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'QArefully Materials Exchange products fall into food and non-food categories. Each product page displays its consumption classification and any handling warnings.',
      ),
    ).toBeInTheDocument();
  });

  it('uses direct native summary disclosure for FAQ entries', () => {
    const { container } = renderHelpRoute('/help/faq');

    const details = screen.getByText('Is this a real shop?').closest('details');
    expect(details).not.toBeNull();
    expect(details?.firstElementChild?.tagName).toBe('SUMMARY');
    expect(details?.querySelector(':scope > summary')).toHaveTextContent('Is this a real shop?');
    expect(container.querySelectorAll('details > summary')).toHaveLength(5);
  });

  it.each([
    ['/help/missing', 'help'],
    ['/policies/missing', 'policy'],
  ])('renders the shared 404 for an unknown %s slug', (path) => {
    renderHelpRoute(path);

    expect(screen.getByRole('heading', { level: 1, name: '404' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Page not found' })).toBeInTheDocument();
  });
});
