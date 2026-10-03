import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { BackInStockSubscription } from '@shop/contracts/back-in-stock';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotifyWhenAvailableButton } from './NotifyWhenAvailableButton';

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  pendingVariantIds: new Set<number>(),
  subscribe: vi.fn(),
  error: null as string | null,
}));

vi.mock('@/hooks/AuthContext', () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock('@/hooks/useBackInStock', () => ({
  useBackInStock: () => ({
    subscriptions: [],
    pendingVariantIds: state.pendingVariantIds,
    loading: false,
    error: state.error,
    refresh: vi.fn(),
    subscribe: state.subscribe,
    cancel: vi.fn(),
  }),
}));

function Path() {
  return <output>{useLocation().pathname}</output>;
}

const NOTIFY = 'Notify me when this is back in stock';
const NOTIFIED = 'You will be notified when this is back in stock';

describe('NotifyWhenAvailableButton', () => {
  beforeEach(() => {
    state.user = null;
    state.pendingVariantIds = new Set<number>();
    state.error = null;
    state.subscribe.mockReset();
  });

  it('sends anonymous buyers to sign-in without issuing a subscribe request', async () => {
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
                <NotifyWhenAvailableButton variantId={3} />
                <Path />
              </>
            }
          />
          <Route path="/login" element={<Path />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.setup().click(screen.getByRole('button', { name: NOTIFY }));
    expect(screen.getByText('/login')).toBeInTheDocument();
    expect(state.subscribe).not.toHaveBeenCalled();
  });

  it('subscribes a signed-in buyer and prevents duplicate submissions while pending', async () => {
    state.user = { id: 'u' };
    let resolveSubscribe!: (value: BackInStockSubscription | false) => void;
    let subscribePromise!: Promise<BackInStockSubscription | false>;
    state.subscribe.mockImplementation(() => {
      subscribePromise = new Promise<BackInStockSubscription | false>(
        (resolve) => (resolveSubscribe = resolve),
      );
      return subscribePromise;
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <NotifyWhenAvailableButton variantId={3} />
      </MemoryRouter>,
    );

    const button = screen.getByRole('button', { name: NOTIFY });
    await user.click(button);
    expect(button).toBeDisabled();
    await user.click(button);
    expect(state.subscribe).toHaveBeenCalledOnce();
    expect(state.subscribe).toHaveBeenCalledWith(3);
    await act(async () => {
      resolveSubscribe(false);
      await subscribePromise;
    });
  });

  it('names the subscribed state distinctly once the buyer is on the waiting list', () => {
    state.user = { id: 'u' };
    state.pendingVariantIds = new Set([3]);
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <NotifyWhenAvailableButton variantId={3} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: NOTIFIED })).toBeDisabled();
    expect(screen.queryByRole('button', { name: NOTIFY })).not.toBeInTheDocument();
  });

  it('announces the mapped failure message the failed subscribe published', async () => {
    state.user = { id: 'u' };
    // The message only exists once the write settles, exactly as the shared state produces it.
    state.subscribe.mockImplementation(() => {
      state.error = "You're already on the waiting list for this item.";
      return Promise.resolve(false);
    });
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <NotifyWhenAvailableButton variantId={3} />
      </MemoryRouter>,
    );

    await userEvent.setup().click(screen.getByRole('button', { name: NOTIFY }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "You're already on the waiting list for this item.",
    );
  });

  it('replaces the previous failure message when a second attempt fails differently', async () => {
    state.user = { id: 'u' };
    state.subscribe
      .mockImplementationOnce(() => {
        state.error = "You're already on the waiting list for this item.";
        return Promise.resolve(false);
      })
      .mockImplementationOnce(() => {
        state.error = 'This item is back in stock already. Add it to your order now.';
        return Promise.resolve(false);
      });
    const user = userEvent.setup();
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <NotifyWhenAvailableButton variantId={3} />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: NOTIFY }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "You're already on the waiting list for this item.",
    );
    await user.click(screen.getByRole('button', { name: NOTIFY }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This item is back in stock already. Add it to your order now.',
    );
  });
});
