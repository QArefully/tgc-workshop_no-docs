import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import { saveOrderAsSavedList } from '@/api/savedLists';
import { SaveOrderAsListButton } from './SaveOrderAsListButton';

const state: { user: { id: string } | null } = vi.hoisted(() => ({ user: { id: 'buyer' } }));
vi.mock('@/hooks/AuthContext', () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock('@/api/savedLists', () => ({ saveOrderAsSavedList: vi.fn() }));

describe('SaveOrderAsListButton', () => {
  it('sends the exact order payload and blocks duplicate submissions while pending', async () => {
    let resolveSave!: (value: { listId: string }) => void;
    vi.mocked(saveOrderAsSavedList).mockReturnValueOnce(
      new Promise((resolve) => (resolveSave = resolve)) as never,
    );
    const user = userEvent.setup();
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SaveOrderAsListButton orderId="order-1" />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText('List name'), ' Previous order ');
    const save = screen.getByRole('button', { name: 'Save list' });
    await user.click(save);
    expect(saveOrderAsSavedList).toHaveBeenCalledWith('order-1', { name: 'Previous order' });
    expect(save).toBeDisabled();
    resolveSave({ listId: 'list-2' });
    expect(await screen.findByRole('link', { name: 'View saved list' })).toHaveAttribute(
      'href',
      '/lists/list-2',
    );
  });

  it('shows duplicate-name failures inline', async () => {
    const nameTaken = new ApiError('Taken', 409, { error: 'Taken' });
    Object.assign(nameTaken.response!, { code: 'NAME_TAKEN' });
    vi.mocked(saveOrderAsSavedList).mockRejectedValueOnce(nameTaken);
    const user = userEvent.setup();
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SaveOrderAsListButton orderId="order-1" />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText('List name'), 'Previous order');
    await user.click(screen.getByRole('button', { name: 'Save list' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
  });
});
