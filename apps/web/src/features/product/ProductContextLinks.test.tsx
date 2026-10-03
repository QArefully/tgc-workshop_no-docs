import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  getProductCommerceLinks,
  getProductFactLinks,
} from '@/features/help/content/helpContentRegistry';
import { ProductContextLinks } from './ProductContextLinks';

const renderedFactLinks = [
  getProductFactLinks('US').powderSafety,
  getProductFactLinks('US').storage,
  getProductFactLinks('US').packSizes,
];
const packSizesLink = renderedFactLinks[2];
if (!packSizesLink) throw new Error('Pack-size link fixture is required.');

function renderLinks(packagingQuantity?: string) {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ProductContextLinks packagingQuantity={packagingQuantity} />
    </MemoryRouter>,
  );
}

describe('ProductContextLinks', () => {
  it('shows pack-size guidance only when a packaging quantity exists', () => {
    const { rerender } = renderLinks();
    expect(screen.queryByRole('link', { name: packSizesLink.label })).not.toBeInTheDocument();

    rerender(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ProductContextLinks packagingQuantity="500g" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: packSizesLink.label })).toHaveAttribute(
      'href',
      packSizesLink.path,
    );
  });

  it('renders only canonical registry labels and paths', () => {
    renderLinks('250g');

    for (const link of [...renderedFactLinks, ...Object.values(getProductCommerceLinks('US'))]) {
      expect(screen.getByRole('link', { name: link.label })).toHaveAttribute('href', link.path);
    }
  });
});
