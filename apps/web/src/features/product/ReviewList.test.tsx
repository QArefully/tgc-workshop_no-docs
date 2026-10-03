import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Review } from '@shop/contracts/reviews';
import { describe, expect, it, vi } from 'vitest';
import { ReviewList } from './ReviewList';

const review: Review = {
  id: '1',
  productId: 'p1',
  author: { displayName: 'Ada' },
  rating: 4,
  body: 'A genuinely useful product review.',
  verifiedPurchase: true,
  helpfulCount: 2,
  viewerCanEngage: true,
  viewerHasHelpfulVote: false,
  viewerHasOpenReport: false,
  createdAt: '2026-07-14T00:00:00.000Z',
  updatedAt: '2026-07-14T00:00:00.000Z',
};

function renderList(overrides: Partial<Review> = {}) {
  const onToggleHelpful = vi.fn().mockResolvedValue(true);
  const onSubmitReport = vi.fn().mockResolvedValue(true);
  const onWithdrawReport = vi.fn().mockResolvedValue(true);
  render(
    <ReviewList
      reviews={[{ ...review, ...overrides }]}
      engagementStatus={null}
      engagementErrors={{}}
      onToggleHelpful={onToggleHelpful}
      onSubmitReport={onSubmitReport}
      onWithdrawReport={onWithdrawReport}
      isEngagementMutating={() => false}
    />,
  );
  return { onToggleHelpful, onSubmitReport, onWithdrawReport };
}

describe('ReviewList', () => {
  it('shows public helpful count but hides engagement controls for ineligible viewers', () => {
    renderList({ viewerCanEngage: false });

    expect(screen.getByText('2 people found this helpful')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Helpful' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Report review' })).not.toBeInTheDocument();
  });

  it('exposes helpful state as a pressed toggle', () => {
    renderList({ viewerHasHelpfulVote: true });

    expect(screen.getByRole('button', { name: 'Helpful', pressed: true })).toBeInTheDocument();
  });

  it('submits report disclosure and returns focus to its trigger', async () => {
    const user = userEvent.setup();
    const onSubmitReport = vi.fn();

    function ReportingList() {
      const [hasOpenReport, setHasOpenReport] = useState(false);
      return (
        <ReviewList
          reviews={[{ ...review, viewerHasOpenReport: hasOpenReport }]}
          engagementStatus={null}
          engagementErrors={{}}
          onToggleHelpful={vi.fn().mockResolvedValue(true)}
          onSubmitReport={(reviewId, body) => {
            onSubmitReport(reviewId, body);
            setHasOpenReport(true);
            return Promise.resolve(true);
          }}
          onWithdrawReport={vi.fn().mockResolvedValue(true)}
          isEngagementMutating={() => false}
        />
      );
    }

    render(<ReportingList />);
    const trigger = screen.getByRole('button', { name: 'Report review' });

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await user.selectOptions(screen.getByLabelText('Reason'), 'other');
    await user.type(screen.getByLabelText(/Detail/), 'Needs moderation');
    await user.click(screen.getByRole('button', { name: 'Submit report' }));

    expect(onSubmitReport).toHaveBeenCalledWith('1', {
      reason: 'other',
      detail: 'Needs moderation',
    });
    expect(await screen.findByRole('button', { name: 'Withdraw report' })).toHaveFocus();
  });

  it('shows a polite result and disables only the active review', () => {
    render(
      <ReviewList
        reviews={[review, { ...review, id: '2', author: { displayName: 'Grace' } }]}
        engagementStatus="Marked this review helpful."
        engagementErrors={{}}
        onToggleHelpful={vi.fn().mockResolvedValue(true)}
        onSubmitReport={vi.fn().mockResolvedValue(true)}
        onWithdrawReport={vi.fn().mockResolvedValue(true)}
        isEngagementMutating={(reviewId) => reviewId === '1'}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Marked this review helpful.');
    expect(screen.getAllByRole('button', { name: 'Helpful' })[0]).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Helpful' })[1]).toBeEnabled();
  });
});
