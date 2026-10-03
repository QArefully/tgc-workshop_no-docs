import { Type, type Static } from '@sinclair/typebox';
import { PositiveIntegerString, Uuid } from './common.js';

const UtcIsoInstant = Type.String({
  minLength: 24,
  maxLength: 24,
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$',
});
const SafeNonNegativeInteger = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const SafePositiveInteger = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });

/** Queue policy is shared so deterministic API and operator transports describe one runtime. */
export const JOB_MAX_ATTEMPTS = 5;
export const JOB_BACKOFF_BASE_MS = 1_000;
export const JOB_BACKOFF_CAP_MS = 60_000;
export const JOB_LEASE_MS = 30_000;

export const JobStatus = Type.Union([
  Type.Literal('pending'),
  Type.Literal('running'),
  Type.Literal('succeeded'),
  Type.Literal('failed'),
  Type.Literal('dead'),
]);
export type JobStatus = Static<typeof JobStatus>;

export const JobKind = Type.Union([
  Type.Literal('notification.deliver'),
  Type.Literal('webhook.process'),
  Type.Literal('standing_order.run'),
  Type.Literal('back_in_stock.notify'),
]);
export type JobKind = Static<typeof JobKind>;

export const JobAttemptOutcome = Type.Union([
  Type.Literal('succeeded'),
  Type.Literal('failed'),
  Type.Literal('abandoned'),
]);
export type JobAttemptOutcome = Static<typeof JobAttemptOutcome>;

/** Admin-safe queue record. Payload remains opaque because it is handler-owned transport. */
export const AdminJob = Type.Object(
  {
    id: PositiveIntegerString,
    kind: JobKind,
    dedupeKey: Type.Union([Type.String({ minLength: 1, maxLength: 255 }), Type.Null()]),
    payload: Type.Unknown(),
    status: JobStatus,
    attempts: SafeNonNegativeInteger,
    maxAttempts: SafePositiveInteger,
    runAt: UtcIsoInstant,
    leaseExpiresAt: Type.Union([UtcIsoInstant, Type.Null()]),
    lastError: Type.Union([Type.String({ minLength: 1, maxLength: 2_000 }), Type.Null()]),
    createdAt: UtcIsoInstant,
    updatedAt: UtcIsoInstant,
  },
  { additionalProperties: false },
);
export type AdminJob = Static<typeof AdminJob>;

export const AdminJobAttempt = Type.Object(
  {
    id: PositiveIntegerString,
    jobId: PositiveIntegerString,
    attemptNumber: SafePositiveInteger,
    startedAt: UtcIsoInstant,
    finishedAt: Type.Union([UtcIsoInstant, Type.Null()]),
    outcome: JobAttemptOutcome,
    error: Type.Union([Type.String({ minLength: 1, maxLength: 2_000 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type AdminJobAttempt = Static<typeof AdminJobAttempt>;

export const AdminJobDetail = Type.Object(
  { ...AdminJob.properties, attemptsLedger: Type.Array(AdminJobAttempt) },
  { additionalProperties: false },
);
export type AdminJobDetail = Static<typeof AdminJobDetail>;

export const AdminJobListQuery = Type.Object(
  {
    status: Type.Optional(JobStatus),
    kind: Type.Optional(JobKind),
    page: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000 })),
    pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);
export type AdminJobListQuery = Static<typeof AdminJobListQuery>;

export const AdminJobPage = Type.Object(
  {
    items: Type.Array(AdminJob),
    total: SafeNonNegativeInteger,
    page: Type.Integer({ minimum: 1, maximum: 10_000 }),
    pageSize: Type.Integer({ minimum: 1, maximum: 100 }),
  },
  { additionalProperties: false },
);
export type AdminJobPage = Static<typeof AdminJobPage>;

export const AdminJobRetryBody = Type.Object(
  { idempotencyKey: Uuid },
  { additionalProperties: false },
);
export type AdminJobRetryBody = Static<typeof AdminJobRetryBody>;

export const AdminJobDrainResponse = Type.Object(
  {
    processedCount: SafeNonNegativeInteger,
    succeededCount: SafeNonNegativeInteger,
    failedCount: SafeNonNegativeInteger,
  },
  { additionalProperties: false },
);
export type AdminJobDrainResponse = Static<typeof AdminJobDrainResponse>;
