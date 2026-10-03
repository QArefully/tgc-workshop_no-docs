import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import {
  MailboxMessage,
  SystemMailboxTemplate,
  SystemMailboxTemplateKey,
  MailboxOrderReceipt,
  LegacyMailboxKind,
  LegacyMailboxMessage,
  type MailboxMessage as MailboxMessageType,
} from '../src/mailbox.js';

const identity = {
  id: '41',
  recipient: 'buyer@example.test',
  subject: 'Message',
  body: 'Message body',
  created: '2026-08-07T10:00:00.000Z',
} as const;

void test('legacy mailbox snapshots remain valid', () => {
  const historicalKinds = [
    'reset',
    'company-invite',
    'order_confirmation',
    'order-approval-request',
    'data_export',
    'notification',
    'plain',
  ] as const;
  for (const kind of historicalKinds) {
    const legacy: MailboxMessageType = { ...identity, kind };
    assert.equal(Value.Check(LegacyMailboxKind, kind), true);
    assert.equal(Value.Check(MailboxMessage, legacy), true);
  }

  const legacy: MailboxMessageType = { ...identity, kind: 'reset' };
  assert.equal(Value.Check(MailboxMessage, { ...legacy, unexpected: true }), false);
  assert.equal(Value.Check(LegacyMailboxKind, 'unknown_legacy_kind'), false);
  assert.equal(Value.Check(LegacyMailboxMessage, { ...identity, kind: 'template' }), false);
  assert.equal(Value.Check(LegacyMailboxMessage, { ...identity, kind: 'order_receipt' }), false);
  assert.equal(Value.Check(MailboxMessage, { ...identity, kind: 'template' }), false);
  assert.equal(Value.Check(MailboxMessage, { ...identity, kind: 'order_receipt' }), false);
});

/** Compile-time regression: reserved discriminants select structured branches safely. */
function narrowedMailboxValue(message: MailboxMessageType): string {
  if (message.kind === 'template') return message.templateKey;
  if (message.kind === 'order_receipt') return message.orderId;
  const legacyKind: LegacyMailboxKind = message.kind;
  return legacyKind;
}

void test('mailbox kind narrowing keeps structured branches distinct from legacy', () => {
  assert.equal(narrowedMailboxValue({ ...identity, kind: 'reset' }), 'reset');
  assert.equal(
    narrowedMailboxValue({
      ...identity,
      kind: 'template',
      templateKey: 'data_export_ready',
      templateParams: {},
      country: 'UK',
    }),
    'data_export_ready',
  );
  assert.equal(
    narrowedMailboxValue({
      ...identity,
      kind: 'order_receipt',
      orderId: '3401',
      country: 'UK',
      subtotalCents: 1,
      discountCents: 0,
      totalCents: 1,
      deliveryChargeCents: 0,
      deliverySlot: { date: '2026-08-12', window: 'am' },
    }),
    '3401',
  );
});

void test('system template keys and code-specific parameters are strict', () => {
  assert.equal(Value.Check(SystemMailboxTemplateKey, 'password_reset'), true);
  assert.equal(Value.Check(SystemMailboxTemplateKey, 'unknown_template'), false);

  const passwordReset = {
    ...identity,
    kind: 'template',
    templateKey: 'password_reset',
    templateParams: { resetUrl: 'https://shop.example/reset?token=abc' },
    country: 'UK',
  } as const;
  assert.equal(Value.Check(SystemMailboxTemplate, passwordReset), true);
  assert.equal(
    Value.Check(SystemMailboxTemplate, {
      ...passwordReset,
      templateParams: { resetUrl: passwordReset.templateParams.resetUrl, token: 'abc' },
    }),
    false,
  );

  const invite = {
    ...identity,
    kind: 'template',
    templateKey: 'company_invite',
    templateParams: {
      companyName: 'Northwind Materials',
      inviteUrl: 'https://shop.example/invite?token=abc',
      role: 'approver',
      expiresAt: '2026-08-08T10:00:00.000Z',
    },
    country: 'DE',
  } as const;
  assert.equal(Value.Check(MailboxMessage, invite), true);

  const approval = {
    ...identity,
    kind: 'template',
    templateKey: 'order_approval_request',
    templateParams: {
      companyName: 'Northwind Materials',
      approvalRequestId: '12',
      totalCents: 12_500,
    },
    country: 'US',
  } as const;
  assert.equal(Value.Check(MailboxMessage, approval), true);

  const exportReady = {
    ...identity,
    kind: 'template',
    templateKey: 'data_export_ready',
    templateParams: {},
    country: 'FR',
  } as const;
  assert.equal(Value.Check(MailboxMessage, exportReady), true);
});

void test('order receipt carries canonical pence facts and rejects converted or mixed variants', () => {
  const receipt: MailboxMessageType = {
    ...identity,
    kind: 'order_receipt',
    orderId: '3401',
    country: 'UK',
    subtotalCents: 12_500,
    discountCents: 500,
    totalCents: 12_999,
    deliveryChargeCents: 999,
    deliverySlot: { date: '2026-08-12', window: 'am' },
    purchaseOrderReference: 'PO-42',
  };
  assert.equal(Value.Check(MailboxOrderReceipt, receipt), true);
  assert.equal(
    Value.Check(MailboxMessage, {
      ...receipt,
      convertedTotal: 15_000,
    }),
    false,
  );
  assert.equal(
    Value.Check(MailboxMessage, {
      ...receipt,
      templateKey: 'password_reset',
      templateParams: { resetUrl: 'https://shop.example/reset' },
    }),
    false,
  );
  assert.equal(Value.Check(MailboxMessage, { ...receipt, totalCents: -1 }), false);
});
