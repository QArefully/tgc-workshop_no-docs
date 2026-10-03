import assert from 'node:assert/strict';
import test from 'node:test';
import type { MailboxMessage } from '@shop/contracts/mailbox';
import { createSeededAppFixture } from '../support/seededDatabase.js';
import { createMailboxRepository } from '../../src/features/mailbox/mailboxRepository.js';
import { createOrderRepository } from '../../src/features/orders/orderRepository.js';

void test('mailbox route returns canonical receipt facts and typed templates', async (t) => {
  const fixture = await createSeededAppFixture(t);
  const { db, app } = fixture;
  const mailbox = createMailboxRepository(db);
  const orderId = createOrderRepository(db).create({
    country: 'DE',
    customerName: 'Mailbox buyer',
    customerEmail: 'mailbox@example.test',
    shippingAddress: '1 Mailbox Lane',
    promoApplied: null,
    subtotalCents: 12_500,
    discountCents: 500,
    totalCents: 12_999,
    userId: null,
    items: [],
    deliveryMode: 'freight',
    deliveryChargeCents: 999,
    deliveryWeightGrams: 100_000,
    deliverySlot: { date: '2026-08-14', window: 'am' },
    purchaseOrderReference: 'PO-42',
    createdAt: '2026-08-07T10:00:00.000Z',
  });
  mailbox.add({
    recipient: 'mailbox@example.test',
    subject: 'Order confirmation',
    body: 'Structured receipt',
    kind: 'order_receipt',
    orderId,
    createdAt: '2026-08-07T10:01:00.000Z',
  });
  mailbox.add({
    recipient: 'mailbox@example.test',
    subject: 'Reset',
    body: 'Reset body',
    kind: 'template',
    templateKey: 'password_reset',
    templateParams: { resetUrl: 'https://web.example.test/reset' },
    country: 'DE',
    createdAt: '2026-08-07T10:02:00.000Z',
  });
  mailbox.add({
    recipient: 'mailbox@example.test',
    subject: 'Legacy',
    body: 'Legacy body',
    kind: 'plain',
    createdAt: '2026-08-07T10:03:00.000Z',
  });

  const response = await app.inject({ method: 'GET', url: '/api/dev/mailbox' });
  assert.equal(response.statusCode, 200);
  const messages = response.json<MailboxMessage[]>();
  const receipt = messages.find((message) => message.kind === 'order_receipt');
  assert.deepEqual(receipt, {
    id: receipt?.id,
    recipient: 'mailbox@example.test',
    subject: 'Order confirmation',
    body: 'Structured receipt',
    created: '2026-08-07T10:01:00.000Z',
    kind: 'order_receipt',
    orderId: String(orderId),
    country: 'DE',
    subtotalCents: 12_500,
    discountCents: 500,
    totalCents: 12_999,
    deliveryChargeCents: 999,
    deliverySlot: { date: '2026-08-14', window: 'am' },
    purchaseOrderReference: 'PO-42',
  });
  assert.equal('convertedTotal' in (receipt ?? {}), false);
  assert.equal(
    messages.some((message) => message.kind === 'template'),
    true,
  );
  assert.equal(
    messages.some((message) => message.kind === 'plain'),
    true,
  );
  assert.equal(
    (
      db.prepare('SELECT order_id, body FROM dev_mailbox WHERE kind = ?').get('order_receipt') as {
        order_id: number;
        body: string;
      }
    ).order_id,
    orderId,
  );
  assert.throws(
    () =>
      mailbox.add({
        recipient: 'mailbox@example.test',
        subject: 'Invalid',
        body: 'Invalid',
        kind: 'template',
        templateKey: 'password_reset',
        templateParams: { token: 'not-a-reset-url' },
        country: 'DE',
        createdAt: '2026-08-07T10:04:00.000Z',
      }),
    /Invalid mailbox template parameters/,
  );
});
