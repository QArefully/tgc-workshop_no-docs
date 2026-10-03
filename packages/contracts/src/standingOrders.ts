import { Type, type Static } from '@sinclair/typebox';
import { PositiveIntegerString } from './common.js';
import { ReorderLineOutcome } from './reorder.js';

const UtcIsoInstant = Type.String({
  minLength: 24,
  maxLength: 24,
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$',
});
const SafeNonNegativeInteger = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const StandingOrderName = Type.String({
  minLength: 1,
  maxLength: 120,
  pattern: '^(?!\\s*$)[^<>]*$',
});

export const StandingOrderCadence = Type.Union([
  Type.Literal('weekly'),
  Type.Literal('fortnightly'),
  Type.Literal('monthly'),
]);
export type StandingOrderCadence = Static<typeof StandingOrderCadence>;

export const StandingOrderSource = Type.Union([
  Type.Object(
    { kind: Type.Literal('saved_list'), listId: PositiveIntegerString },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal('order'), orderId: PositiveIntegerString },
    { additionalProperties: false },
  ),
]);
export type StandingOrderSource = Static<typeof StandingOrderSource>;

export const StandingOrder = Type.Object(
  {
    id: PositiveIntegerString,
    name: StandingOrderName,
    source: StandingOrderSource,
    cadence: StandingOrderCadence,
    nextRunAt: UtcIsoInstant,
    lastRunAt: Type.Union([UtcIsoInstant, Type.Null()]),
    active: Type.Boolean(),
    createdAt: UtcIsoInstant,
    updatedAt: UtcIsoInstant,
  },
  { additionalProperties: false },
);
export type StandingOrder = Static<typeof StandingOrder>;

/** Reuses reorder's source-line fields and its closed shared skip-reason vocabulary. */
export const StandingOrderLineOutcome = ReorderLineOutcome;
export type StandingOrderLineOutcome = Static<typeof StandingOrderLineOutcome>;

export const StandingOrderRunStatus = Type.Union([
  Type.Literal('pending'),
  Type.Literal('completed'),
  Type.Literal('failed'),
]);
export type StandingOrderRunStatus = Static<typeof StandingOrderRunStatus>;

export const StandingOrderRun = Type.Object(
  {
    id: PositiveIntegerString,
    standingOrderId: PositiveIntegerString,
    jobId: Type.Union([PositiveIntegerString, Type.Null()]),
    cartId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    runAt: UtcIsoInstant,
    status: StandingOrderRunStatus,
    addedLineCount: SafeNonNegativeInteger,
    skippedLineCount: SafeNonNegativeInteger,
    outcomes: Type.Union([Type.Array(StandingOrderLineOutcome), Type.Null()]),
    failureReason: Type.Union([Type.String({ minLength: 1, maxLength: 2_000 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type StandingOrderRun = Static<typeof StandingOrderRun>;

export const CreateStandingOrderBody = Type.Object(
  { name: StandingOrderName, source: StandingOrderSource, cadence: StandingOrderCadence },
  { additionalProperties: false },
);
export type CreateStandingOrderBody = Static<typeof CreateStandingOrderBody>;

export const UpdateStandingOrderBody = Type.Object(
  {
    name: Type.Optional(StandingOrderName),
    cadence: Type.Optional(StandingOrderCadence),
    active: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type UpdateStandingOrderBody = Static<typeof UpdateStandingOrderBody>;

export const StandingOrderRunListResponse = Type.Array(StandingOrderRun);
export type StandingOrderRunListResponse = Static<typeof StandingOrderRunListResponse>;
