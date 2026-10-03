import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProductGrid } from './ProductGrid';

describe('ProductGrid', () => {
  it('keeps compact, desktop, and wide-desktop responsive column contracts', () => {
    const { container } = render(
      <ProductGrid>
        <article>Product</article>
      </ProductGrid>,
    );

    expect(container.firstElementChild).toHaveClass(
      'min-[440px]:grid-cols-2',
      'lg:grid-cols-4',
      'min-[1440px]:grid-cols-5',
    );
  });
});
