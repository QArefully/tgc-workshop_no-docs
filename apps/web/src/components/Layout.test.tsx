import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Layout } from './Layout';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('network disabled in test'))),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Layout', () => {
  it('constrains the main content to the shared content shell width', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Layout />
      </MemoryRouter>,
    );

    // Settles the shell's mount-time session/cart/catalog fetches before asserting.
    const main = await screen.findByRole('main');

    expect(main).toHaveClass('content-shell');
    // `w-full` sits in Tailwind's utilities layer and would override the shell's
    // clamped width, making every page bleed to the viewport edges.
    expect(main).not.toHaveClass('w-full');
  });
});
