import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CompareProductButton } from './CompareProductButton';
import { ComparisonSelectionProvider } from './ComparisonSelectionContext';
import { ComparisonTray } from './ComparisonTray';

const storage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

function renderTray() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ComparisonSelectionProvider storage={storage}>
        <ComparisonTray />
        {['1', '2', '3', '4', '5'].map((id) => (
          <CompareProductButton key={id} productId={id} />
        ))}
      </ComparisonSelectionProvider>
    </MemoryRouter>,
  );
}

describe('ComparisonTray', () => {
  it('uses selection order for its comparison link and clear action', async () => {
    const user = userEvent.setup();
    renderTray();

    const buttons = screen.getAllByRole('button', { name: 'Compare product' });
    await user.click(buttons[1]!);
    await user.click(buttons[0]!);

    expect(screen.getByRole('link', { name: 'Compare selected' })).toHaveAttribute(
      'href',
      '/compare?ids=2,1',
    );
    await user.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.getByText('0 products selected for comparison')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Compare selected' })).toBeDisabled();
  });

  it('announces capacity when a fifth product is selected', async () => {
    const user = userEvent.setup();
    renderTray();

    for (const button of screen.getAllByRole('button', { name: 'Compare product' })) {
      await user.click(button);
    }

    expect(screen.getByRole('status')).toHaveTextContent('You can compare up to 4 products.');
    expect(screen.getByText('4 products selected for comparison')).toBeVisible();
  });
});
