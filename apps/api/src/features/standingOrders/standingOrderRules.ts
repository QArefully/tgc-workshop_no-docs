import type {
  StandingOrderCadence,
  StandingOrderLineOutcome,
} from '@shop/contracts/standing-orders';

export function nextRunAt(from: Date, cadence: StandingOrderCadence): Date {
  const result = new Date(from.getTime());
  if (cadence === 'weekly') result.setUTCDate(result.getUTCDate() + 7);
  else if (cadence === 'fortnightly') result.setUTCDate(result.getUTCDate() + 14);
  else {
    const day = result.getUTCDate();
    const isEndOfMonth =
      day === new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
    result.setUTCDate(1);
    result.setUTCMonth(result.getUTCMonth() + 1);
    const lastDay = new Date(
      Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
    ).getUTCDate();
    // A monthly schedule created on month-end stays on month-end after February rather than
    // drifting permanently to the 28th (or 29th). Other dates retain their calendar day.
    result.setUTCDate(isEndOfMonth ? lastDay : Math.min(day, lastDay));
  }
  return result;
}

export function standingOrderDedupeKey(standingOrderId: number, scheduledRunAt: string): string {
  return `standing-order:${standingOrderId}:${scheduledRunAt}`;
}

export function countOutcomes(outcomes: readonly StandingOrderLineOutcome[]) {
  let addedLineCount = 0;
  for (const outcome of outcomes) if (outcome.status === 'added') addedLineCount++;
  return { addedLineCount, skippedLineCount: outcomes.length - addedLineCount };
}
