import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SavedListPicker } from './SavedListPicker';

const actions = vi.hoisted(() => ({
  createList: vi.fn<(...args: unknown[]) => Promise<{ listId: string } | false>>(),
  addItem: vi.fn<(...args: unknown[]) => Promise<{ listId: string } | false>>(),
  failureMessage: null as string | null,
}));
vi.mock('@/hooks/useSavedLists', () => ({
  useSavedLists: () => {
    const [error, setError] = useState<string | null>(null);
    return {
      lists: [],
      error,
      createList: async (...args: unknown[]) => {
        const result = await actions.createList(...args);
        if (!result) setError(actions.failureMessage);
        return result;
      },
      addItem: actions.addItem,
    };
  },
}));

describe('SavedListPicker', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    actions.failureMessage = null;
  });

  it.each([
    ['NAME_TAKEN', 'A saved list with this name already exists. Choose a different name.'],
    [
      'LIST_LIMIT_REACHED',
      'You have reached the saved-list limit. Remove a list before creating another.',
    ],
  ])(
    'shows the actionable %s failure returned by the saved-list mutation',
    async (_code, message) => {
      actions.failureMessage = message;
      actions.createList.mockResolvedValueOnce(false);
      const user = userEvent.setup();
      render(<SavedListPicker variantId={1} />);

      await user.type(screen.getByRole('textbox', { name: 'New list name' }), 'Depot restock');
      await user.click(screen.getByRole('button', { name: 'Create list and save' }));

      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(message));
      expect(actions.createList).toHaveBeenCalledWith({ name: 'Depot restock' });
    },
  );
});
