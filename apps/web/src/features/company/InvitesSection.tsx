import { useState, type FormEvent } from 'react';
import type { CompanyInvite } from '@shop/contracts/company-accounts';
import { Button } from '@/components/ui/button';
import { useLocalisation } from '@/i18n/LocaleContext';
import {
  tradeAsyncMessages,
  type TradeAsyncMessageKey,
} from '@shop/localisation/messages/tradeAsync';

type Props = {
  invites: CompanyInvite[];
  onInvite: (email: string, role: 'buyer' | 'approver') => Promise<void>;
  onRevoke: (id: string) => Promise<void>;
};
export function InvitesSection({ invites, onInvite, onRevoke }: Props) {
  const { translate } = useLocalisation();
  const t = <K extends TradeAsyncMessageKey>(
    key: K,
    params?: Record<string, string | number | bigint>,
  ) => translate(tradeAsyncMessages, key, params);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'buyer' | 'approver'>('buyer');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await onInvite(email, role);
      setEmail('');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mt-6 rounded-lg border p-5">
      <h2 className="font-semibold">{t('company.invite.heading')}</h2>
      <form onSubmit={(event) => void submit(event)} className="mt-3 flex flex-wrap gap-2">
        <input
          aria-label={t('company.invite.email')}
          required
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="min-w-52 flex-1 rounded-md border px-3 py-2 text-sm"
          placeholder={t('company.invite.placeholder')}
        />
        <select
          aria-label={t('company.invite.role')}
          value={role}
          onChange={(event) => setRole(event.target.value as 'buyer' | 'approver')}
          className="rounded-md border px-2 py-1 text-sm"
        >
          <option value="buyer">{t('company.role.buyer')}</option>
          <option value="approver">{t('company.role.approver')}</option>
        </select>
        <Button type="submit" disabled={busy}>
          {busy ? t('company.invite.sending') : t('company.invite.send')}
        </Button>
      </form>
      {invites.length > 0 && (
        <ul className="mt-4 divide-y">
          <h3 className="pb-2 text-sm font-medium">{t('company.invite.pending')}</h3>
          {invites.map((invite) => (
            <li key={invite.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>
                {t('company.invite.item', {
                  email: invite.email,
                  role: t(`company.role.${invite.role}` as TradeAsyncMessageKey),
                })}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void onRevoke(invite.id)}
              >
                {t('company.invite.revoke')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
