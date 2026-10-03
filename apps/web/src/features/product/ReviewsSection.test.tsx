import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ReviewListResponse } from '@shop/contracts/reviews';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UseProductReviewsResult } from '@/hooks/useProductReviews';
import { ReviewsSection } from './ReviewsSection';

const state = vi.hoisted(() => ({
  auth: {
    user: null as { id: string; email: string; displayName: string; role: 'customer' } | null,
    loading: false,
  },
  reviews: null as UseProductReviewsResult | null,
}));

vi.mock('@/hooks/AuthContext', () => ({ useAuth: () => state.auth }));
vi.mock('@/hooks/useProductReviews', () => ({ useProductReviews: () => state.reviews }));

const list: ReviewListResponse = {
  summary: {
    total: 1,
    averageRating: 4,
    distribution: [
      { rating: 1, count: 0 },
      { rating: 2, count: 0 },
      { rating: 3, count: 0 },
      { rating: 4, count: 1 },
      { rating: 5, count: 0 },
    ],
  },
  items: [
    {
      id: '1',
      productId: 'p1',
      author: { displayName: 'Ada' },
      rating: 4,
      body: 'A genuinely useful product review.',
      verifiedPurchase: true,
      helpfulCount: 0,
      viewerCanEngage: false,
      viewerHasHelpfulVote: false,
      viewerHasOpenReport: false,
      createdAt: '2026-07-14T00:00:00.000Z',
      updatedAt: '2026-07-14T00:00:00.000Z',
    },
  ],
  page: 1,
  pageSize: 10,
};

function reviewState(): UseProductReviewsResult {
  return {
    list,
    listError: null,
    isListLoading: false,
    ownerReview: null,
    ownerError: null,
    isOwnerLoading: false,
    sort: 'newest' as const,
    page: 1,
    isMutating: false,
    mutationError: null,
    engagementStatus: null,
    engagementErrors: {},
    setSort: vi.fn(),
    setPage: vi.fn(),
    retryList: vi.fn(),
    retryOwner: vi.fn(),
    submitReview: vi.fn().mockResolvedValue(true),
    removeReview: vi.fn().mockResolvedValue(true),
    toggleHelpful: vi.fn().mockResolvedValue(true),
    submitReport: vi.fn().mockResolvedValue(true),
    withdrawReport: vi.fn().mockResolvedValue(true),
    isEngagementMutating: vi.fn().mockReturnValue(false),
  };
}

function Destination() {
  const location = useLocation();
  return <p data-testid="destination">{JSON.stringify(location.state)}</p>;
}

describe('ReviewsSection', () => {
  afterEach(() => {
    state.auth = { user: null, loading: false };
    state.reviews = null;
  });

  it('keeps published reviews visible and preserves the full location for anonymous sign-in', async () => {
    state.reviews = reviewState();
    const user = userEvent.setup();
    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={['/products/p1?source=review#write']}
      >
        <Routes>
          <Route path="/products/p1" element={<ReviewsSection productId="p1" />} />
          <Route path="/login" element={<Destination />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByLabelText('Review summary')).toBeInTheDocument();
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByLabelText('Verified purchase')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Sign in to write a review' }));
    expect(screen.getByTestId('destination')).toHaveTextContent('/products/p1?source=review#write');
  });

  it('shows a local retry when public reviews fail', () => {
    state.reviews = { ...reviewState(), list: null, listError: 'offline' };
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ReviewsSection productId="p1" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load reviews.');
  });

  it('keeps an empty published review list explicit', () => {
    state.reviews = {
      ...reviewState(),
      list: { ...list, summary: { ...list.summary, total: 0 }, items: [] },
    };
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ReviewsSection productId="p1" />
      </MemoryRouter>,
    );

    expect(screen.getByText('No published reviews yet.')).toBeInTheDocument();
  });

  it('keeps published reviews visible when the owner request fails', () => {
    state.auth.user = {
      id: 'customer',
      email: 'customer@example.com',
      displayName: 'Customer',
      role: 'customer',
    };
    state.reviews = { ...reviewState(), ownerError: 'offline' };
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ReviewsSection productId="p1" />
      </MemoryRouter>,
    );

    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load your review.');
  });
});
