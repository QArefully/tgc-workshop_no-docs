import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getCompany } from '@/api/companyAccounts';
import { useLocalisation } from '@/i18n/LocaleContext';
import { identityAccountMessages } from '@shop/localisation/messages/identityAccount';

/** Account-page shortcut only; permissions remain resolved by each protected destination. */
export function CompanyMembershipSection() {
  const { translate } = useLocalisation();
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void getCompany()
      .then((account) => {
        if (active)
          setLabel(
            account
              ? `${account.company.name} · ${account.membership.role}`
              : translate(identityAccountMessages, 'account.company.none'),
          );
      })
      .catch(() => {
        if (active) setLabel(translate(identityAccountMessages, 'account.company.unavailable'));
      });
    return () => {
      active = false;
    };
  }, [translate]);
  return (
    <div className="mt-6 rounded-lg border p-6">
      <h2 className="text-sm font-medium text-muted-foreground">
        {translate(identityAccountMessages, 'account.company.title')}
      </h2>
      <p className="mt-2 text-sm">
        {label ?? translate(identityAccountMessages, 'account.company.unavailable')}
      </p>
      <div className="mt-3 flex gap-4 text-sm">
        <Link className="underline" to="/account/company">
          {translate(identityAccountMessages, 'account.company.manage')}
        </Link>
        <Link className="underline" to="/account/approvals">
          {translate(identityAccountMessages, 'account.company.approvals')}
        </Link>
      </div>
    </div>
  );
}
