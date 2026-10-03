import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { SaveToListButton } from './SaveToListButton';

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  ids: new Set<number>(),
  toggle: vi.fn(),
  loading: false,
  error: null as string | null,
}));
vi.mock('@/hooks/AuthContext', () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock('@/hooks/useSavedLists', () => ({
  useSavedLists: () => ({
    savedVariantIds: state.ids,
    toggleDefaultSave: state.toggle,
    loading: state.loading,
    error: state.error,
  }),
}));
function Path() {
  return <output>{useLocation().pathname}</output>;
}

describe('SaveToListButton', () => {
  it('returns anonymous customers to sign-in from the full current path', async () => {
    state.user = null;
    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={['/products/a?source=card']}
      >
        <Routes>
          <Route
            path="*"
            element={
              <>
                <SaveToListButton variantId={3} />
                <Path />
              </>
            }
          />
          <Route path="/login" element={<Path />} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.setup().click(screen.getByRole('button'));
    expect(screen.getByText('/login')).toBeInTheDocument();
  });
  it('uses the current variant instead of a stale product default', async () => {
    state.user = { id: 'u' };
    state.ids = new Set([4]);
    state.toggle.mockReset();
    const { rerender } = render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SaveToListButton variantId={3} quantity={2} />
      </MemoryRouter>,
    );
    rerender(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SaveToListButton variantId={4} quantity={7} />
      </MemoryRouter>,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Remove from default list' }));
    expect(state.toggle).toHaveBeenCalledWith(4, 7);
  });

  it('announces a failed toggle after rolling back and prevents duplicate submissions', async () => {
    state.user = { id: 'u' };
    state.ids = new Set([3]);
    state.error = 'Saved list is unavailable.';
    let resolveToggle!: (value: boolean) => void;
    state.toggle
      .mockReset()
      .mockReturnValue(new Promise<boolean>((resolve) => (resolveToggle = resolve)));
    const user = userEvent.setup();
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SaveToListButton variantId={3} />
      </MemoryRouter>,
    );

    const button = screen.getByRole('button', { name: 'Remove from default list' });
    await user.click(button);
    expect(button).toBeDisabled();
    await user.click(button);
    expect(state.toggle).toHaveBeenCalledOnce();
    resolveToggle(false);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to update the saved list. Please try again.',
    );
  });
});
