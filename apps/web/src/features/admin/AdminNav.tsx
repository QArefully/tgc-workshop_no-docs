import { NavLink } from 'react-router-dom';
import { useMessages } from '@/i18n/LocaleContext';
import { adminDiagnosticsMessages } from '@shop/localisation/messages/adminDiagnostics';

const sections = [
  { label: 'admin.shell.overview', to: '/admin', global: false },
  { label: 'admin.shell.products', to: '/admin/products', global: false },
  { label: 'admin.shell.variants', to: '/admin/variants', global: false },
  { label: 'admin.shell.promotions', to: '/admin/promos', global: false },
  { label: 'admin.shell.users', to: '/admin/users', global: false },
  { label: 'admin.shell.orders', to: '/admin/orders', global: false },
  { label: 'admin.shell.creditAccounts', to: '/admin/credit-accounts', global: false },
  { label: 'admin.shell.invoices', to: '/admin/invoices', global: false },
  { label: 'admin.shell.jobs', to: '/admin/jobs', global: true },
  { label: 'admin.shell.webhooks', to: '/admin/webhooks', global: true },
  { label: 'admin.shell.featureFlags', to: '/admin/feature-flags', global: true },
  { label: 'admin.shell.reviewModeration', to: '/admin/reviews', global: false },
] as const;

/** Stable administration navigation shared by all admin routes. */
export function AdminNav() {
  const t = useMessages(adminDiagnosticsMessages);
  return (
    <nav
      aria-label={t('admin.shell.navigationLabel')}
      className="rounded-lg border border-border bg-card p-3"
    >
      <ul className="flex flex-wrap gap-1">
        {sections.map(({ label, to, global }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={to === '/admin'}
              className={({ isActive }) =>
                `block rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                }`
              }
            >
              {t(label)}
              {global && (
                <span className="ml-1 text-[0.65rem] font-semibold uppercase tracking-wide opacity-70">
                  {t('admin.shell.global')}
                </span>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
