import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomBlendBaseListResponse, CustomBlendOption } from '@shop/contracts/custom-blends';

import { ApiError } from '@/api/client';
import { getCustomBlendBases } from '@/api/customBlends';
import { BasePicker, SelectedBaseChip } from './BasePicker';

vi.mock('@/api/customBlends', () => ({ getCustomBlendBases: vi.fn() }));

function option(
  variantId: number,
  productName: string,
  category = 'Trade & Creative Materials',
  mixingGroup: CustomBlendOption['mixingGroup'] = 'mineral',
): CustomBlendOption {
  return {
    productId: String(variantId),
    productName,
    productDescription: `${productName} description`,
    mixingGroup,
    category,
    consumptionClassification: mixingGroup === 'food-grade' ? 'food' : 'non-food',
    categoryFacts: {
      texture: 'Fine',
      colour: 'Grey',
      source: 'Test source',
      intendedUse: 'Testing',
      storage: 'Dry cool',
      consumptionClassification: mixingGroup === 'food-grade' ? 'food' : 'non-food',
    },
    variant: {
      variantId,
      productId: variantId,
      sku: `MAT-${variantId}`,
      label: '25 kg sack',
      weightGrams: 25_000,
      priceCents: 1_200,
      moqSacks: 4,
      perTonneCents: 48_000,
      priceTiers: [{ minTonnes: 1, discountPct: 0 }],
      stockCount: 0,
      backorderable: false,
      backorderLeadDays: null,
      deliveryClass: 'freight',
      active: true,
      sortOrder: 1,
    },
  };
}

function response(
  items: readonly CustomBlendOption[],
  pagination: Partial<Pick<CustomBlendBaseListResponse, 'total' | 'page' | 'pageSize'>> = {},
): CustomBlendBaseListResponse {
  return {
    items: [...items],
    total: pagination.total ?? items.length,
    page: pagination.page ?? 1,
    pageSize: pagination.pageSize ?? 12,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function SearchOwnedPicker() {
  const [searchParams, setSearchParams] = useSearchParams();
  return (
    <>
      <BasePicker
        onSelectBase={(variantId) => setSearchParams({ baseVariantId: String(variantId) })}
      />
      <output data-testid="base-variant-id">{searchParams.get('baseVariantId') ?? ''}</output>
    </>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('BasePicker', () => {
  it('renders the server-approved options without a client-side group allowlist', async () => {
    vi.mocked(getCustomBlendBases).mockResolvedValue(
      response([
        option(40, 'Yellow Ochre', 'Trade & Creative Materials', 'mineral'),
        option(41, 'Food Binder', 'Sports Nutrition', 'food-grade'),
      ]),
    );

    render(<BasePicker onSelectBase={vi.fn()} />);

    expect(
      await screen.findByRole('button', { name: 'Use Yellow Ochre as base' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use Food Binder as base' })).toBeInTheDocument();
    expect(
      screen.getByText('Sports Nutrition', { selector: '[data-slot="badge"]' }),
    ).toBeInTheDocument();
    expect(getCustomBlendBases).toHaveBeenCalledWith({}, expect.any(AbortSignal));
  });

  it('forwards trimmed search and category filters to the server', async () => {
    const user = userEvent.setup();
    vi.mocked(getCustomBlendBases).mockResolvedValue(response([option(40, 'Yellow Ochre')]));

    render(<BasePicker onSelectBase={vi.fn()} />);
    await screen.findByRole('button', { name: 'Use Yellow Ochre as base' });
    await user.type(screen.getByLabelText('Search materials'), ' cement ');
    await user.selectOptions(screen.getByLabelText('Category'), 'Trade & Creative Materials');

    await waitFor(() => {
      expect(getCustomBlendBases).toHaveBeenLastCalledWith(
        { q: 'cement', category: 'Trade & Creative Materials' },
        expect.any(AbortSignal),
      );
    });
  });

  it('aggregates every server page and derives categories from the complete eligible result', async () => {
    const firstPage = Array.from({ length: 12 }, (_, index) =>
      option(100 + index, `First Material ${index + 1}`),
    );
    const laterPage = option(200, 'Later Pigment', 'Later Eligible Category');
    vi.mocked(getCustomBlendBases)
      .mockResolvedValueOnce(response(firstPage, { total: 13, page: 1, pageSize: 12 }))
      .mockResolvedValueOnce(response([laterPage], { total: 13, page: 2, pageSize: 12 }));

    render(<BasePicker onSelectBase={vi.fn()} />);

    expect(
      await screen.findByRole('button', { name: 'Use Later Pigment as base' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Later Eligible Category' })).toBeInTheDocument();
    expect(getCustomBlendBases).toHaveBeenNthCalledWith(1, {}, expect.any(AbortSignal));
    expect(getCustomBlendBases).toHaveBeenNthCalledWith(
      2,
      { page: 2, pageSize: 12 },
      expect.any(AbortSignal),
    );
    expect(vi.mocked(getCustomBlendBases).mock.calls[0]?.[1]).toBe(
      vi.mocked(getCustomBlendBases).mock.calls[1]?.[1],
    );
    expect(vi.mocked(getCustomBlendBases).mock.calls[1]?.[1]?.aborted).toBe(false);
  });

  it('exposes loading and empty states accessibly', async () => {
    const pending = deferred<CustomBlendBaseListResponse>();
    vi.mocked(getCustomBlendBases).mockReturnValue(pending.promise);

    render(<BasePicker onSelectBase={vi.fn()} />);
    expect(screen.getByRole('status', { name: 'Loading materials' })).toHaveAttribute(
      'aria-busy',
      'true',
    );

    await act(async () => {
      pending.resolve(response([]));
      await pending.promise;
    });
    expect(await screen.findByRole('status')).toHaveTextContent('No materials match that search.');
  });

  it('shows a coded, localised error and supports retry', async () => {
    const user = userEvent.setup();
    vi.mocked(getCustomBlendBases)
      .mockRejectedValueOnce(
        new ApiError('private server prose', 400, {
          error: 'private server prose',
          code: 'CUSTOM_BLEND_INVALID',
        }),
      )
      .mockResolvedValueOnce(response([option(40, 'Yellow Ochre')]));

    render(<BasePicker onSelectBase={vi.fn()} />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The custom blend is no longer valid.');
    expect(alert).not.toHaveTextContent('private server prose');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('button', { name: 'Use Yellow Ochre as base' }),
    ).toBeInTheDocument();
  });

  it('aborts and drops a stale response after a newer filter request', async () => {
    const stale = deferred<CustomBlendBaseListResponse>();
    vi.mocked(getCustomBlendBases)
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(response([option(42, 'Current Material')]));

    render(<BasePicker onSelectBase={vi.fn()} />);
    const oldSignal = vi.mocked(getCustomBlendBases).mock.calls[0]?.[1];
    fireEvent.change(screen.getByLabelText('Search materials'), { target: { value: 'current' } });
    expect(
      await screen.findByRole('button', { name: 'Use Current Material as base' }),
    ).toBeInTheDocument();
    expect(oldSignal?.aborted).toBe(true);

    await act(async () => {
      stale.resolve(response([option(41, 'Stale Material')]));
      await stale.promise;
    });
    expect(
      screen.queryByRole('button', { name: 'Use Stale Material as base' }),
    ).not.toBeInTheDocument();
  });

  it('aborts an in-flight later page and drops its stale result after a newer filter request', async () => {
    const firstPage = deferred<CustomBlendBaseListResponse>();
    const staleLaterPage = deferred<CustomBlendBaseListResponse>();
    vi.mocked(getCustomBlendBases)
      .mockReturnValueOnce(firstPage.promise)
      .mockReturnValueOnce(staleLaterPage.promise)
      .mockResolvedValueOnce(response([option(302, 'Current Material')]));

    render(<BasePicker onSelectBase={vi.fn()} />);
    await act(async () => {
      firstPage.resolve(
        response([option(301, 'First Material')], { total: 13, page: 1, pageSize: 12 }),
      );
      await firstPage.promise;
    });
    await waitFor(() => expect(getCustomBlendBases).toHaveBeenCalledTimes(2));
    const stalePageSignal = vi.mocked(getCustomBlendBases).mock.calls[1]?.[1];

    fireEvent.change(screen.getByLabelText('Search materials'), {
      target: { value: 'current' },
    });
    expect(
      await screen.findByRole('button', { name: 'Use Current Material as base' }),
    ).toBeInTheDocument();
    expect(stalePageSignal?.aborted).toBe(true);

    await act(async () => {
      staleLaterPage.resolve(response([option(303, 'Stale Later Material')], { page: 2 }));
      await staleLaterPage.promise;
    });
    expect(
      screen.queryByRole('button', { name: 'Use Stale Later Material as base' }),
    ).not.toBeInTheDocument();
  });

  it('lets the URL owner receive the selected server variant id', async () => {
    const user = userEvent.setup();
    vi.mocked(getCustomBlendBases).mockResolvedValue(response([option(901, 'Yellow Ochre')]));

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SearchOwnedPicker />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: 'Use Yellow Ochre as base' }));
    expect(await screen.findByTestId('base-variant-id')).toHaveTextContent('901');
  });

  it('renders the selected base as an option-backed artwork chip', () => {
    render(<SelectedBaseChip base={option(901, 'Yellow Ochre')} onChange={vi.fn()} />);

    expect(screen.getByLabelText('Yellow Ochre packaging')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change base material' })).toBeInTheDocument();
  });
});
