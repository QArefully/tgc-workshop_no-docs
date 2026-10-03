import type { CompanyMembership, CompanyMembershipRole } from '@shop/contracts/company-accounts';
import { Button } from '@/components/ui/button';
import { useLocalisation } from '@/i18n/LocaleContext';
import {
  tradeAsyncMessages,
  type TradeAsyncMessageKey,
} from '@shop/localisation/messages/tradeAsync';

type Props = {
  members: CompanyMembership[];
  isOwner: boolean;
  busyId: string | null;
  onRoleChange: (id: string, role: Exclude<CompanyMembershipRole, 'owner'>) => void;
  onRevoke: (id: string) => void;
};

export function MembersSection({ members, isOwner, busyId, onRoleChange, onRevoke }: Props) {
  const { translate } = useLocalisation();
  const t = <K extends TradeAsyncMessageKey>(
    key: K,
    params?: Record<string, string | number | bigint>,
  ) => translate(tradeAsyncMessages, key, params);
  return (
    <section className="mt-6 rounded-lg border p-5">
      <h2 className="font-semibold">{t('company.members')}</h2>
      <ul className="mt-3 divide-y">
        {members.map((member) => (
          <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <p className="font-medium">
                {member.user?.displayName ?? t('company.member.fallback')}
              </p>
              <p className="text-sm text-muted-foreground">{member.user?.email ?? ''}</p>
            </div>
            {isOwner && member.role !== 'owner' ? (
              <div className="flex items-center gap-2">
                <select
                  aria-label={t('company.member.roleFor', {
                    member: member.user?.email ?? member.id,
                  })}
                  value={member.role}
                  disabled={busyId === member.id}
                  onChange={(event) =>
                    onRoleChange(member.id, event.target.value as 'buyer' | 'approver')
                  }
                  className="rounded-md border px-2 py-1 text-sm"
                >
                  <option value="buyer">{t('company.role.buyer')}</option>
                  <option value="approver">{t('company.role.approver')}</option>
                </select>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busyId === member.id}
                  onClick={() => onRevoke(member.id)}
                >
                  {t('company.remove')}
                </Button>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">
                {t(`company.role.${member.role}` as TradeAsyncMessageKey)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
