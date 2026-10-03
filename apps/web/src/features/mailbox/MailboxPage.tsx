import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getMailbox } from '@/api/mailbox';
import { useLocalisation } from '@/i18n/LocaleContext';
import { formatCivilDate, formatDualTotal, formatInstant } from '@shop/localisation';
import {
  tradeAsyncMessages,
  translateTradeAsync,
  type TradeAsyncMessageKey,
} from '@shop/localisation/messages/tradeAsync';
import type { Country } from '@shop/contracts/country';
import type { CompanyInviteRole } from '@shop/contracts/company-accounts';
import type {
  MailboxMessage,
  MailboxOrderReceipt,
  SystemMailboxTemplate,
} from '@shop/contracts/mailbox';

type RenderedMailbox = {
  subject: string;
  body: string;
  link?: string;
  receipt?: MailboxOrderReceipt;
  country: Country;
};

function dualMoney(pence: number, country: Country): string {
  const total = formatDualTotal(pence, country);
  return total.settlement ? `${total.display} (${total.settlement})` : total.display;
}

function companyRoleMessageKey(role: CompanyInviteRole): TradeAsyncMessageKey {
  return `company.role.${role}` as TradeAsyncMessageKey;
}

export function renderTemplate(message: SystemMailboxTemplate): RenderedMailbox {
  const country = message.country;
  switch (message.templateKey) {
    case 'password_reset':
      return {
        country,
        subject: translateTradeAsync(country, 'mail.passwordReset.subject'),
        body: translateTradeAsync(country, 'mail.passwordReset.body', message.templateParams),
        link: message.templateParams.resetUrl,
      };
    case 'company_invite':
      return {
        country,
        subject: translateTradeAsync(country, 'mail.companyInvite.subject', message.templateParams),
        body: translateTradeAsync(country, 'mail.companyInvite.body', {
          ...message.templateParams,
          role: translateTradeAsync(country, companyRoleMessageKey(message.templateParams.role)),
          expiresAt: formatInstant(message.templateParams.expiresAt, country),
        }),
        link: message.templateParams.inviteUrl,
      };
    case 'order_approval_request':
      return {
        country,
        subject: translateTradeAsync(country, 'mail.orderApproval.subject', message.templateParams),
        body: translateTradeAsync(country, 'mail.orderApproval.body', {
          ...message.templateParams,
          total: dualMoney(message.templateParams.totalCents, country),
        }),
      };
    case 'data_export_ready':
      return {
        country,
        subject: translateTradeAsync(country, 'mail.dataExport.subject'),
        body: translateTradeAsync(country, 'mail.dataExport.body'),
      };
  }
}

export function renderReceipt(message: MailboxOrderReceipt): RenderedMailbox {
  const country = message.country;
  const deliveryWindow = translateTradeAsync(
    country,
    `mail.orderReceipt.deliveryWindow.${message.deliverySlot.window}` as TradeAsyncMessageKey,
  );
  return {
    country,
    subject: translateTradeAsync(country, 'mail.orderReceipt.subject', {
      orderId: message.orderId,
    }),
    body: translateTradeAsync(country, 'mail.orderReceipt.body', {
      orderId: message.orderId,
      total: dualMoney(message.totalCents, country),
      deliveryDate: formatCivilDate(message.deliverySlot.date, country, 'medium'),
      deliveryWindow,
    }),
    receipt: message,
  };
}

function renderLegacy(
  message: Extract<
    MailboxMessage,
    { kind: Exclude<MailboxMessage['kind'], 'template' | 'order_receipt'> }
  >,
  country: Country,
): RenderedMailbox {
  const resetLink = message.body.match(/https?:\/\/[^\s]+\/reset-password\?token=[^\s]+/)?.[0];
  return { country, subject: message.subject, body: message.body, link: resetLink };
}

function materialize(message: MailboxMessage, activeCountry: Country): RenderedMailbox {
  if (message.kind === 'template') return renderTemplate(message);
  if (message.kind === 'order_receipt') return renderReceipt(message);
  return renderLegacy(message, activeCountry);
}

/** Dev mailbox page. Typed system rows render from descriptor data at read time. */
export function MailboxPage() {
  const { activeCountry, translate } = useLocalisation();
  const t = useCallback(
    (key: TradeAsyncMessageKey, params?: Readonly<Record<string, string | number | bigint>>) =>
      translate(tradeAsyncMessages, key, params),
    [translate],
  );
  const [messages, setMessages] = useState<MailboxMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    async function fetchMailbox() {
      try {
        const data = await getMailbox();
        if (!cancelled) setMessages(data);
      } catch {
        if (!cancelled) setError(translateTradeAsync(activeCountry, 'mail.legacy.error'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void fetchMailbox();
    return () => {
      cancelled = true;
    };
  }, [activeCountry]);

  const rendered = useMemo(
    () => messages.map((message) => ({ message, rendered: materialize(message, activeCountry) })),
    [activeCountry, messages],
  );

  if (loading) {
    return (
      <div className="py-20 text-center">
        <p className="text-muted-foreground">{t('mail.legacy.loading')}</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="py-20 text-center">
        <p className="text-red-500">{error}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl py-10">
      <h1 className="text-2xl font-bold">{t('mail.legacy.heading')}</h1>
      {rendered.length === 0 ? (
        <p className="mt-8 text-center text-muted-foreground">{t('mail.legacy.empty')}</p>
      ) : (
        <ul className="mt-6 space-y-4">
          {rendered.map(({ message, rendered: item }) => (
            <li key={message.id} className="rounded-lg border p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">
                    {t('mail.legacy.to', { recipient: message.recipient })}
                  </p>
                  <p className="mt-1 font-medium">{item.subject}</p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {formatInstant(message.created, item.country)}
                </span>
              </div>
              <div className="mt-2 text-sm">
                {item.link ? (
                  <Link
                    to={item.link.replace('http://127.0.0.1:5173', '')}
                    className="break-all text-blue-600 underline"
                  >
                    {item.link}
                  </Link>
                ) : (
                  <p className="whitespace-pre-wrap text-muted-foreground">{item.body}</p>
                )}
              </div>
              {item.receipt && (
                <dl className="mt-3 space-y-1 border-t pt-3 text-sm text-muted-foreground">
                  <div className="flex justify-between gap-4">
                    <dt>{translateTradeAsync(item.country, 'mail.orderReceipt.subtotalLabel')}</dt>
                    <dd>{dualMoney(item.receipt.subtotalCents, item.country)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt>{translateTradeAsync(item.country, 'mail.orderReceipt.discountLabel')}</dt>
                    <dd>{dualMoney(item.receipt.discountCents, item.country)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt>
                      {translateTradeAsync(item.country, 'mail.orderReceipt.deliveryChargeLabel')}
                    </dt>
                    <dd>{dualMoney(item.receipt.deliveryChargeCents, item.country)}</dd>
                  </div>
                  {item.receipt.purchaseOrderReference && (
                    <div className="flex justify-between gap-4">
                      <dt>
                        {translateTradeAsync(item.country, 'mail.orderReceipt.purchaseOrderLabel')}
                      </dt>
                      <dd>{item.receipt.purchaseOrderReference}</dd>
                    </div>
                  )}
                </dl>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
