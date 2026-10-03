import type {
  DeliveryDate,
  DeliveryLeadTime,
  DeliverySlot,
  DeliverySlotWindow,
  DeliverySummary,
} from '@shop/contracts/delivery';
import {
  DELIVERY_SLOT_HORIZON_BUSINESS_DAYS,
  FREIGHT_BASE_LEAD_TIME_BUSINESS_DAYS,
  FREIGHT_HEAVY_LEAD_TIME_EXTRA_BUSINESS_DAYS,
  FREIGHT_HEAVY_WEIGHT_THRESHOLD_GRAMS,
  PARCEL_LEAD_TIME_BUSINESS_DAYS,
} from '@shop/contracts/delivery';
import type { CountryProfile } from '@shop/contracts/country-profiles';

/**
 * Pure delivery scheduling rules. Every date is derived from an injected instant
 * and an explicit country profile; nothing here reads an ambient clock, locale,
 * or time zone.
 *
 * The scheduling anchor is the profile's local civil day. At or after the
 * profile's local `deliveryCutoffHour`, the anchor advances by one civil calendar
 * day before business-day arithmetic begins. The exact cut-off is inclusive
 * (`localHour >= deliveryCutoffHour`). Civil date and hour are resolved with an
 * explicit locale and the profile's IANA time zone, so daylight-saving changes
 * cannot skip or duplicate a scheduling day.
 *
 * Lead-time ladder (chosen for this repository, derived from the contract constants):
 *
 * - parcel, any weight -> `PARCEL_LEAD_TIME_BUSINESS_DAYS` (1) business day
 * - freight, weight below `FREIGHT_HEAVY_WEIGHT_THRESHOLD_GRAMS` (1 000 000 g = 1 t)
 *   -> `FREIGHT_BASE_LEAD_TIME_BUSINESS_DAYS` (3) business days
 * - freight, weight at or above that threshold -> base plus
 *   `FREIGHT_HEAVY_LEAD_TIME_EXTRA_BUSINESS_DAYS` (2) = 5 business days
 *
 * The ladder has exactly two freight steps. The heavy step is inclusive at the
 * threshold (`>=`), matching `quoteDelivery`'s freight threshold comparison, so a
 * consignment of exactly one tonne is heavy. There is no third tier and no
 * per-tonne accumulation.
 *
 * Slots are offered on business days only (Saturday and Sunday excluded), `am`
 * and `pm` per day, from `earliestDate` through `latestDate` inclusive, where the
 * window spans `DELIVERY_SLOT_HORIZON_BUSINESS_DAYS` (15) business days counted
 * inclusively from `earliestDate`.
 *
 * Slot identity is `date` + `window` only. There is no capacity model: two buyers
 * may hold the same slot. That is intended product behavior, not an oversight.
 */

const MS_PER_DAY = 86_400_000;
const SLOT_WINDOWS: readonly DeliverySlotWindow[] = ['am', 'pm'];
const DELIVERY_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** UTC-backed calendar representation of the profile's cut-off-adjusted local civil day. */
function deliveryAnchorDay(instant: Date, profile: CountryProfile): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: profile.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    if (!part) throw new Error(`Missing ${type} in local delivery date`);
    return Number(part.value);
  };
  const localYear = value('year');
  const localMonth = value('month');
  const localDay = value('day');
  const localHour = value('hour');
  const localDayStart = Date.UTC(localYear, localMonth - 1, localDay);
  return localHour >= profile.deliveryCutoffHour ? localDayStart + MS_PER_DAY : localDayStart;
}

/** `YYYY-MM-DD` render of a midnight-UTC day, locale-independent. */
function toDeliveryDate(dayStart: number): DeliveryDate {
  return new Date(dayStart).toISOString().slice(0, 10);
}

/**
 * Midnight-UTC epoch millis for a `YYYY-MM-DD` string, or `undefined` when the
 * string is malformed or not a real calendar date (e.g. `2026-02-30`).
 */
function parseDeliveryDate(date: string): number | undefined {
  if (!DELIVERY_DATE_PATTERN.test(date)) return undefined;
  const parsed = Date.parse(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed)) return undefined;
  // Rejects overflow dates that `Date.parse` would otherwise roll forward.
  if (toDeliveryDate(parsed) !== date) return undefined;
  return parsed;
}

function isBusinessDay(dayStart: number): boolean {
  const weekday = new Date(dayStart).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

/** Next business day strictly after `dayStart`. */
function nextBusinessDay(dayStart: number): number {
  let cursor = dayStart + MS_PER_DAY;
  while (!isBusinessDay(cursor)) {
    cursor += MS_PER_DAY;
  }
  return cursor;
}

/**
 * Adds `businessDays` business days to the calendar day of `from`. Weekends are
 * skipped. Zero business days snaps forward to the next business day when `from`
 * itself falls on a weekend, so the result is always a business day.
 */
function addBusinessDays(from: number, businessDays: number): number {
  let cursor = from;
  while (!isBusinessDay(cursor)) {
    cursor += MS_PER_DAY;
  }
  for (let step = 0; step < businessDays; step += 1) {
    cursor = nextBusinessDay(cursor);
  }
  return cursor;
}

export interface CalculateLeadTimeInput {
  deliverySummary: Pick<DeliverySummary, 'mode' | 'weightGrams'>;
  now: Date;
  profile: CountryProfile;
}

export interface ListBookableSlotsInput {
  /**
   * Carries the bookable horizon: the range runs from `earliestDate` through
   * `latestDate` inclusive. There is no separate horizon argument — widening or
   * narrowing the window is done by producing a different `leadTime`.
   */
  leadTime: DeliveryLeadTime;
  now: Date;
  profile: CountryProfile;
}

/**
 * Derives the bookable date range for a quoted consignment.
 *
 * `businessDays` is the ladder step used; `earliestDate` is that many business
 * days after the cut-off-adjusted local civil day; `latestDate` closes an inclusive
 * `DELIVERY_SLOT_HORIZON_BUSINESS_DAYS`-business-day window. `reason` is plain
 * buyer-facing text with no jargon and no markup characters.
 */
export function calculateLeadTime({
  deliverySummary,
  now,
  profile,
}: CalculateLeadTimeInput): DeliveryLeadTime {
  const heavy =
    deliverySummary.mode === 'freight' &&
    deliverySummary.weightGrams >= FREIGHT_HEAVY_WEIGHT_THRESHOLD_GRAMS;

  const businessDays =
    deliverySummary.mode === 'freight'
      ? FREIGHT_BASE_LEAD_TIME_BUSINESS_DAYS +
        (heavy ? FREIGHT_HEAVY_LEAD_TIME_EXTRA_BUSINESS_DAYS : 0)
      : PARCEL_LEAD_TIME_BUSINESS_DAYS;

  const today = deliveryAnchorDay(now, profile);
  const earliest = addBusinessDays(today, businessDays);
  const latest = addBusinessDays(earliest, DELIVERY_SLOT_HORIZON_BUSINESS_DAYS - 1);

  const dayWord = businessDays === 1 ? 'working day' : 'working days';
  const reason =
    deliverySummary.mode === 'freight'
      ? heavy
        ? `This is a heavy load, so we need ${businessDays} ${dayWord} to consolidate and load it before delivery.`
        : `Freight loads need ${businessDays} ${dayWord} to prepare before delivery.`
      : `We need ${businessDays} ${dayWord} to pack and hand over your order.`;

  return {
    earliestDate: toDeliveryDate(earliest),
    latestDate: toDeliveryDate(latest),
    businessDays,
    reason,
  };
}

/**
 * Every slot a buyer may book for the given lead time: business days only,
 * `am` then `pm` per day, ascending, inclusive of both boundary dates.
 *
 * The horizon is carried entirely by `leadTime.earliestDate` and
 * `leadTime.latestDate`; no other input widens or narrows the range.
 *
 * Generation delegates admissibility to {@link isSlotBookable}, so a slot can
 * never be offered that re-validation would later reject.
 */
export function listBookableSlots({
  leadTime,
  now,
  profile,
}: ListBookableSlotsInput): DeliverySlot[] {
  const earliest = parseDeliveryDate(leadTime.earliestDate);
  const latest = parseDeliveryDate(leadTime.latestDate);
  if (earliest === undefined || latest === undefined || latest < earliest) return [];

  const slots: DeliverySlot[] = [];
  for (let cursor = earliest; cursor <= latest; cursor += MS_PER_DAY) {
    if (!isBusinessDay(cursor)) continue;
    const date = toDeliveryDate(cursor);
    for (const window of SLOT_WINDOWS) {
      const slot: DeliverySlot = { date, window };
      if (isSlotBookable(slot, leadTime, now, profile)) slots.push(slot);
    }
  }
  return slots;
}

/**
 * Single source of truth for slot admissibility, shared by slot generation and
 * checkout re-validation so the two can never drift.
 *
 * Rejects unknown windows, malformed or impossible dates, weekends, dates before
 * the cut-off-adjusted local civil day, dates before `earliestDate`, and dates
 * after `latestDate`.
 */
export function isSlotBookable(
  slot: DeliverySlot,
  leadTime: DeliveryLeadTime,
  now: Date,
  profile: CountryProfile,
): boolean {
  if (!SLOT_WINDOWS.includes(slot.window)) return false;

  const day = parseDeliveryDate(slot.date);
  if (day === undefined) return false;
  if (!isBusinessDay(day)) return false;

  const earliest = parseDeliveryDate(leadTime.earliestDate);
  const latest = parseDeliveryDate(leadTime.latestDate);
  if (earliest === undefined || latest === undefined) return false;

  if (day < deliveryAnchorDay(now, profile)) return false;
  if (day < earliest) return false;
  if (day > latest) return false;

  return true;
}
