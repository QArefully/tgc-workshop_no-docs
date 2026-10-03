import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CategoryNav } from './CategoryNav';

vi.mock('@/hooks/useCategories', () => ({
  useCategories: () => ({
    categories: ['Sports Nutrition', 'Baking & Pantry'],
    isLoading: false,
    error: null,
  }),
}));

function renderNav(path: string) {
  render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      initialEntries={[path]}
    >
      <CategoryNav />
    </MemoryRouter>,
  );
}

describe('CategoryNav', () => {
  it('links All Materials to the unfiltered catalogue and marks it current only there', () => {
    renderNav('/catalog');

    const allMaterials = screen.getByRole('link', { name: 'All materials' });
    expect(allMaterials).toHaveAttribute('href', '/catalog');
    expect(allMaterials).toHaveAttribute('aria-current', 'page');
  });

  it('marks only the active category link as current', () => {
    renderNav('/catalog?category=Baking+%26+Pantry');

    expect(screen.getByRole('link', { name: 'Baking & Pantry' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'All materials' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Sports Nutrition' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('links to bundles and marks its dedicated page as current', () => {
    renderNav('/bundles');

    const bundles = screen.getByRole('link', { name: 'Bundles' });
    expect(bundles).toHaveAttribute('href', '/bundles');
    expect(bundles).toHaveAttribute('aria-current', 'page');
  });

  it('links to the Custom Blend configurator through the reserved iridescent slot', () => {
    renderNav('/custom-blend');

    const customBlend = screen.getByRole('link', { name: 'Custom Blend' });
    expect(customBlend).toHaveAttribute('href', '/custom-blend');
    expect(customBlend).toHaveAttribute('aria-current', 'page');
    // The frozen visual contract is claimed here and nowhere else.
    expect(customBlend).toHaveClass('custom-blend-nav-link');
    expect(screen.getAllByRole('link', { name: 'Custom Blend' })).toHaveLength(1);
  });

  it('marks Custom Blend as current only on its own route', () => {
    renderNav('/catalog');

    expect(screen.getByRole('link', { name: 'Custom Blend' })).not.toHaveAttribute('aria-current');
  });

  // Guards the frozen colour/motion contract now consumed by the Custom Blend nav entry.
  it('freezes the iridescent animation for reduced motion', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

    expect(styles).toContain('--custom-blend-gradient-duration: 12s;');
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.custom-blend-nav-link \{\s+animation: none;/,
    );
  });
});
