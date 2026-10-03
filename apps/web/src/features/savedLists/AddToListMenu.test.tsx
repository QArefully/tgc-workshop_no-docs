import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AddToListMenu } from './AddToListMenu';

const state = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock('@/hooks/AuthContext', () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock('./SavedListPicker', () => ({
  SavedListPicker: ({ variantId, quantity }: { variantId: number; quantity: number }) => (
    <output data-testid="picker">{`${variantId}:${quantity}`}</output>
  ),
}));
function LocationState() {
  const location = useLocation();
  return <output data-testid="location-state">{JSON.stringify(location.state)}</output>;
}

describe('AddToListMenu', () => {
  it('requires a selected variant and passes the current panel quantity to the picker', async () => {
    state.user = { id: 'buyer' };
    const user = userEvent.setup();
    const { rerender } = render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AddToListMenu variantId={null} quantity={6} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Save to list' })).toBeDisabled();

    rerender(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AddToListMenu variantId={44} quantity={6} />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Save to list' }));
    expect(screen.getByTestId('picker')).toHaveTextContent('44:6');
  });

  it('returns anonymous customers to the complete current path', async () => {
    state.user = null;
    const user = userEvent.setup();
    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={['/products/cement?pack=sack']}
      >
        <Routes>
          <Route path="*" element={<AddToListMenu variantId={44} />} />
          <Route path="/login" element={<LocationState />} />
        </Routes>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Save to list' }));
    expect(screen.getByTestId('location-state')).toHaveTextContent(
      '{"from":"/products/cement?pack=sack"}',
    );
  });
});
