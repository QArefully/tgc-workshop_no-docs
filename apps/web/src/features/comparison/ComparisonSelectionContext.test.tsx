import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ComparisonSelectionProvider, useComparisonSelection } from './ComparisonSelectionContext';
import { COMPARISON_STORAGE_KEY, type ComparisonSelectionStorage } from './comparisonStorage';

function memoryStorage(
  initial?: string,
): ComparisonSelectionStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  if (initial) values.set(COMPARISON_STORAGE_KEY, initial);
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

function SelectionProbe() {
  const { selectedIds, toggle, clear, capacityStatus } = useComparisonSelection();
  return (
    <>
      <output data-testid="selection">{selectedIds.join(',')}</output>
      <output data-testid="capacity">{capacityStatus}</output>
      {['1', '2', '3', '4', '5'].map((id) => (
        <button key={id} onClick={() => toggle(id)}>{`Toggle ${id}`}</button>
      ))}
      <button onClick={clear}>Clear</button>
    </>
  );
}

function renderProvider(storage: ComparisonSelectionStorage) {
  return render(
    <ComparisonSelectionProvider storage={storage}>
      <SelectionProbe />
    </ComparisonSelectionProvider>,
  );
}

describe('ComparisonSelectionProvider', () => {
  it('preserves draft order, rejects fifth selection, and moves re-added IDs to tail', async () => {
    const user = userEvent.setup();
    renderProvider(memoryStorage());

    for (const id of ['1', '2', '3', '4'])
      await user.click(screen.getByRole('button', { name: `Toggle ${id}` }));
    await user.click(screen.getByRole('button', { name: 'Toggle 5' }));
    expect(screen.getByTestId('selection')).toHaveTextContent('1,2,3,4');
    expect(screen.getByTestId('capacity')).toHaveTextContent('at-capacity');

    await user.click(screen.getByRole('button', { name: 'Toggle 2' }));
    await user.click(screen.getByRole('button', { name: 'Toggle 2' }));
    expect(screen.getByTestId('selection')).toHaveTextContent('1,3,4,2');
  });

  it('does not overwrite a complete stored selection when draft becomes incomplete', async () => {
    const user = userEvent.setup();
    const storage = memoryStorage(JSON.stringify(['3', '1']));
    renderProvider(storage);

    await user.click(screen.getByRole('button', { name: 'Toggle 3' }));
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(storage.values.get(COMPARISON_STORAGE_KEY)).toBe(JSON.stringify(['3', '1']));
  });

  it('contains unavailable storage operations', async () => {
    const user = userEvent.setup();
    const storage: ComparisonSelectionStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    renderProvider(storage);

    await user.click(screen.getByRole('button', { name: 'Toggle 1' }));
    await user.click(screen.getByRole('button', { name: 'Toggle 2' }));
    expect(screen.getByTestId('selection')).toHaveTextContent('1,2');
  });
});
