import { Type, type Static } from '@sinclair/typebox';
import { PositiveIntegerString } from './common.js';

const UtcIsoInstant = Type.String({
  minLength: 24,
  maxLength: 24,
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$',
});

export const NotificationKind = Type.Union([
  Type.Literal('order.placed'),
  Type.Literal('order.shipped'),
  Type.Literal('order.cancelled'),
  Type.Literal('standing_order.run_completed'),
  Type.Literal('standing_order.run_failed'),
  Type.Literal('payment.webhook_settled'),
  Type.Literal('back_in_stock.available'),
]);
export type NotificationKind = Static<typeof NotificationKind>;

export const Notification = Type.Object(
  {
    id: PositiveIntegerString,
    kind: NotificationKind,
    title: Type.String({ minLength: 1, maxLength: 160 }),
    body: Type.String({ minLength: 1, maxLength: 2_000 }),
    entityType: Type.Union([Type.String({ minLength: 1, maxLength: 80 }), Type.Null()]),
    entityId: Type.Union([Type.String({ minLength: 1, maxLength: 255 }), Type.Null()]),
    createdAt: UtcIsoInstant,
    readAt: Type.Union([UtcIsoInstant, Type.Null()]),
  },
  { additionalProperties: false },
);
export type Notification = Static<typeof Notification>;

export const NotificationReadStatus = Type.Union([Type.Literal('unread'), Type.Literal('read')]);
export type NotificationReadStatus = Static<typeof NotificationReadStatus>;

export const NotificationListQuery = Type.Object(
  {
    status: Type.Optional(NotificationReadStatus),
    page: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000 })),
    pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);
export type NotificationListQuery = Static<typeof NotificationListQuery>;

export const NotificationPage = Type.Object(
  {
    items: Type.Array(Notification),
    total: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    unreadTotal: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    page: Type.Integer({ minimum: 1, maximum: 10_000 }),
    pageSize: Type.Integer({ minimum: 1, maximum: 100 }),
  },
  { additionalProperties: false },
);
export type NotificationPage = Static<typeof NotificationPage>;

export const MarkAllReadResponse = Type.Object(
  { affectedCount: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }) },
  { additionalProperties: false },
);
export type MarkAllReadResponse = Static<typeof MarkAllReadResponse>;
