import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ComparisonSelectionProvider } from './ComparisonSelectionContext';
import { CompareProductButton } from './CompareProductButton';

const storage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

describe('CompareProductButton', () => {
  it('exposes unselected and selected pressed states', async () => {
    const user = userEvent.setup();
    render(
      <ComparisonSelectionProvider storage={storage}>
        <CompareProductButton productId="1" productName="Powdered Water" />
      </ComparisonSelectionProvider>,
    );

    const button = screen.getByRole('button', { name: 'Compare Powdered Water' });
    expect(button).toHaveAttribute('aria-pressed', 'false');

    await user.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveTextContent('Selected for comparison');
  });
});
