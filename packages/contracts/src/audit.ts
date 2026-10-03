import { Type, type Static } from '@sinclair/typebox';
import { PositiveIntegerString } from './common.js';

export const AuditActorType = Type.Union([
  Type.Literal('anonymous'),
  Type.Literal('user'),
  Type.Literal('system'),
]);
export type AuditActorType = Static<typeof AuditActorType>;

const AuditMetadata = Type.Record(
  Type.String({ minLength: 1, maxLength: 100 }),
  Type.Union([Type.String({ maxLength: 2048 }), Type.Number()]),
);

export const AuditEvent = Type.Object(
  {
    id: PositiveIntegerString,
    actorType: AuditActorType,
    actorUserId: Type.Union([PositiveIntegerString, Type.Null()]),
    action: Type.String({ minLength: 1, maxLength: 100 }),
    entityType: Type.String({ minLength: 1, maxLength: 64 }),
    entityId: Type.Union([Type.String({ minLength: 1, maxLength: 255 }), Type.Null()]),
    requestId: Type.Union([Type.String({ minLength: 1, maxLength: 255 }), Type.Null()]),
    metadata: AuditMetadata,
    occurredAt: Type.String({
      pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$',
    }),
  },
  { additionalProperties: false },
);
export type AuditEvent = Static<typeof AuditEvent>;

export const AuditEventQuery = Type.Object(
  {
    action: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
    entityType: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    entityId: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
    actorUserId: Type.Optional(Type.Integer({ minimum: 1 })),
    requestId: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
    occurredFrom: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
    occurredTo: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
    page: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000 })),
    pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);
export type AuditEventQuery = Static<typeof AuditEventQuery>;

export const AuditEventListResponse = Type.Object(
  {
    items: Type.Array(AuditEvent),
    total: Type.Integer({ minimum: 0 }),
    page: Type.Integer({ minimum: 1, maximum: 10_000 }),
    pageSize: Type.Integer({ minimum: 1, maximum: 100 }),
  },
  { additionalProperties: false },
);
export type AuditEventListResponse = Static<typeof AuditEventListResponse>;
