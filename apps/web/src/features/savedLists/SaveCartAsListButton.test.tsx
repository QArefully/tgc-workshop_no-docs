import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import { saveCartAsSavedList } from '@/api/savedLists';
import { SaveCartAsListButton } from './SaveCartAsListButton';

const state = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock('@/hooks/AuthContext', () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock('@/api/savedLists', () => ({ saveCartAsSavedList: vi.fn() }));
function LocationState() {
  return <output>{JSON.stringify(useLocation().state)}</output>;
}

describe('SaveCartAsListButton', () => {
  it('redirects anonymous customers before requesting a cart conversion', async () => {
    state.user = null;
    const user = userEvent.setup();
    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={['/cart?promotion=summer']}
      >
        <Routes>
          <Route path="*" element={<SaveCartAsListButton cartId="cart-1" excludesBlends />} />
          <Route path="/login" element={<LocationState />} />
        </Routes>
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText('List name'), ' Restock ');
    await user.click(screen.getByRole('button', { name: 'Save list' }));
    expect(saveCartAsSavedList).not.toHaveBeenCalled();
    expect(screen.getByText('{"from":"/cart?promotion=summer"}')).toBeInTheDocument();
  });

  it('discloses blend exclusion, sends the exact payload, and blocks duplicate submissions', async () => {
    state.user = { id: 'buyer' };
    let resolveSave!: (value: { listId: string }) => void;
    vi.mocked(saveCartAsSavedList).mockReturnValueOnce(
      new Promise((resolve) => (resolveSave = resolve)) as never,
    );
    const user = userEvent.setup();
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SaveCartAsListButton cartId="cart-1" excludesBlends />
      </MemoryRouter>,
    );
    expect(screen.getByText(/will not be included/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText('List name'), ' Restock ');
    const save = screen.getByRole('button', { name: 'Save list' });
    await user.click(save);
    expect(saveCartAsSavedList).toHaveBeenCalledWith({ cartId: 'cart-1', name: 'Restock' });
    expect(save).toBeDisabled();
    resolveSave({ listId: 'list-1' });
    expect(await screen.findByRole('link', { name: 'View saved list' })).toHaveAttribute(
      'href',
      '/lists/list-1',
    );
  });

  it('shows cart conversion errors inline', async () => {
    state.user = { id: 'buyer' };
    const cartEmpty = new ApiError('Empty', 400, { error: 'Empty' });
    Object.assign(cartEmpty.response!, { code: 'CART_EMPTY' });
    vi.mocked(saveCartAsSavedList).mockRejectedValueOnce(cartEmpty);
    const user = userEvent.setup();
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SaveCartAsListButton cartId="cart-1" excludesBlends={false} />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText('List name'), 'Restock');
    await user.click(screen.getByRole('button', { name: 'Save list' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your order is empty');
  });
});
