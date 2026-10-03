import { describe, expect, it } from 'vitest';
import type { MailboxOrderReceipt, SystemMailboxTemplate } from '@shop/contracts/mailbox';
import { renderReceipt, renderTemplate } from './MailboxPage';

const identity = {
  id: '1',
  recipient: 'buyer@example.com',
  subject: 'legacy subject',
  body: 'legacy body',
  created: '2026-08-01T00:00:00.000Z',
} as const;

describe('typed mailbox rendering', () => {
  it('keeps a DE template snapshot in its intended language and preserves links', () => {
    const message: SystemMailboxTemplate = {
      ...identity,
      kind: 'template',
      templateKey: 'company_invite',
      templateParams: {
        companyName: 'Acme',
        inviteUrl: 'https://example.test/invite?token=abc',
        role: 'buyer',
        expiresAt: '2026-08-03T12:00:00.000Z',
      },
      country: 'DE',
    };
    const rendered = renderTemplate(message);
    expect(rendered.body).toContain('Acme');
    expect(rendered.body).toContain(message.templateParams.inviteUrl);
    expect(rendered.body).toContain('Käufer');
    expect(rendered.body).not.toContain('buyer');
    expect(rendered.body).not.toContain('Accept your');
    expect(rendered.link).toBe(message.templateParams.inviteUrl);
  });

  it('renders a US receipt with local and authoritative GBP totals at read time', () => {
    const message: MailboxOrderReceipt = {
      ...identity,
      kind: 'order_receipt',
      orderId: '42',
      country: 'US',
      subtotalCents: 5_000,
      discountCents: 0,
      totalCents: 5_000,
      deliveryChargeCents: 999,
      deliverySlot: { date: '2026-08-10', window: 'am' },
    };
    const rendered = renderReceipt(message);
    expect(rendered.body).toMatch(/\$/);
    expect(rendered.body).toMatch(/£/);
    expect(rendered.body).toContain('2026');
    expect(rendered.receipt?.totalCents).toBe(message.totalCents);
  });

  it('keeps a CN receipt snapshot in Chinese when the viewer browses in DE', () => {
    const message: MailboxOrderReceipt = {
      ...identity,
      kind: 'order_receipt',
      orderId: '43',
      country: 'CN',
      subtotalCents: 10_000,
      discountCents: 0,
      totalCents: 10_000,
      deliveryChargeCents: 999,
      deliverySlot: { date: '2026-08-10', window: 'am' },
    };
    const rendered = renderReceipt(message);
    expect(rendered.country).toBe('CN');
    expect(rendered.body).toContain('订单');
    expect(rendered.body).toContain('总额');
    expect(rendered.body).toContain('¥900.00');
    expect(rendered.body).toContain('£100.00');
    expect(rendered.body).not.toContain('Gesamt');
  });
});
