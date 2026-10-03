import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { helpContentRegistry, helpIndexLink } from '@/features/help/content/helpContentRegistry';
import { Footer } from './Footer';

function renderFooter() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Footer />
    </MemoryRouter>,
  );
}

describe('Footer', () => {
  it('covers the Help index and every registry article with stable links', () => {
    renderFooter();

    const navigation = screen.getByRole('navigation', { name: 'Help and policies' });
    const expectedLinks = [helpIndexLink, ...helpContentRegistry];

    expect(within(navigation).getAllByRole('link')).toHaveLength(expectedLinks.length);
    expect(
      within(navigation)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(expectedLinks.map((link) => link.path));

    for (const link of expectedLinks) {
      expect(
        within(navigation).getByRole('link', {
          name: 'label' in link ? link.label : link.title,
        }),
      ).toHaveAttribute('href', link.path);
    }
  });

  it('uses named footer navigation with grouped semantic lists', () => {
    renderFooter();

    expect(screen.getByRole('contentinfo')).toBeInTheDocument();

    for (const heading of ['Help', 'Policies']) {
      const groupHeading = screen.getByRole('heading', { level: 2, name: heading });
      const group = groupHeading.closest('section');

      expect(group).not.toBeNull();
      expect(within(group as HTMLElement).getByRole('list')).toBeInTheDocument();
    }
  });

  it('renders without product-context providers', () => {
    renderFooter();

    expect(screen.getByRole('link', { name: 'Help center' })).toBeInTheDocument();
  });
});
