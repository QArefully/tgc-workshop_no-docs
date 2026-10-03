import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { CategoryTiles } from './CategoryTiles';

describe('CategoryTiles', () => {
  it('keeps six category links with representative artwork', () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <CategoryTiles
          categories={[
            'Sports Nutrition',
            'Baking & Pantry',
            'Drinks',
            'Household & Cleaning',
            'Garden & Outdoors',
            'Trade & Creative Materials',
          ]}
          isLoading={false}
          error={null}
          onRetry={vi.fn()}
        />
      </MemoryRouter>,
    );

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(6);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/catalog?category=Sports%20Nutrition',
      '/catalog?category=Baking%20%26%20Pantry',
      '/catalog?category=Drinks',
      '/catalog?category=Household%20%26%20Cleaning',
      '/catalog?category=Garden%20%26%20Outdoors',
      '/catalog?category=Trade%20%26%20Creative%20Materials',
    ]);

    for (const link of links) {
      expect(
        link.firstElementChild?.matches(
          'img[alt=""], div[aria-hidden="true"], svg[aria-hidden="true"]',
        ),
      ).toBe(true);
    }
  });
});
