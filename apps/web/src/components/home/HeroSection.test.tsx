import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { HeroSection } from './HeroSection';

describe('HeroSection', () => {
  it('renders QArefully Materials Exchange CTA and supply overview', () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <HeroSection />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: /browse materials/i })).toHaveAttribute(
      'href',
      '/catalog',
    );
    expect(
      screen.getByRole('heading', { name: /materials supply with operational clarity/i }),
    ).toBeInTheDocument();
    const overview = screen.getByLabelText('Materials exchange supply overview');
    expect(overview).toBeInTheDocument();
    // The stacked vessels are decorative: three SVGs, none of them exposed to assistive tech.
    expect(overview.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(3);
    expect(screen.queryByText('Exchange board')).not.toBeInTheDocument();
  });
});
