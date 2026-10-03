import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CustomBlendBanner } from './CustomBlendBanner';

describe('CustomBlendBanner', () => {
  it('links buyers to the Custom Blend configurator', () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <CustomBlendBanner />
      </MemoryRouter>,
    );

    expect(screen.getByText('Custom Blend')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Build material to your spec.' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Custom Blend: configure your blend' }),
    ).toHaveAttribute('href', '/custom-blend');
    expect(screen.getByText('Configure your blend')).not.toHaveAttribute('href');
  });

  it('uses the shared motion token for the CTA hover transition', () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <CustomBlendBanner />
      </MemoryRouter>,
    );

    expect(screen.getByText('Configure your blend')).toHaveClass(
      'duration-[var(--custom-blend-motion-duration)]',
    );
  });
});
