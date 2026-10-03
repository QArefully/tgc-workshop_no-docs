import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { useMessages } from '@/i18n/LocaleContext';
import { adminDiagnosticsMessages } from '@shop/localisation/messages/adminDiagnostics';

const sections = [
  ['admin.index.productsTitle', 'admin.index.productsDescription', '/admin/products'],
  ['admin.shell.variants', 'admin.index.variantsDescription', '/admin/variants'],
  ['admin.shell.promotions', 'admin.index.promotionsDescription', '/admin/promos'],
  ['admin.shell.users', 'admin.index.usersDescription', '/admin/users'],
  ['admin.shell.orders', 'admin.index.ordersDescription', '/admin/orders'],
  ['admin.index.creditTitle', 'admin.index.creditDescription', '/admin/credit-accounts'],
  ['admin.index.invoicesTitle', 'admin.index.invoicesDescription', '/admin/invoices'],
  ['admin.shell.jobs', 'admin.index.jobsDescription', '/admin/jobs'],
  ['admin.shell.webhooks', 'admin.index.webhooksDescription', '/admin/webhooks'],
  ['admin.shell.featureFlags', 'admin.index.featureFlagsDescription', '/admin/feature-flags'],
  ['admin.shell.reviewModeration', 'admin.index.reviewModerationDescription', '/admin/reviews'],
] as const;

/** Landing page for administrator-only operational areas. */
export function AdminIndexPage() {
  const t = useMessages(adminDiagnosticsMessages);
  return (
    <div aria-labelledby="admin-index-heading">
      <h2 id="admin-index-heading" className="text-2xl font-semibold tracking-tight">
        {t('admin.index.heading')}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">{t('admin.index.selectArea')}</p>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2">
        {sections.map(([title, description, to]) => (
          <li key={to}>
            <Card className="h-full">
              <CardContent className="space-y-2 py-5">
                <Link to={to} className="font-semibold underline-offset-4 hover:underline">
                  {t(title)}
                </Link>
                <p className="text-sm text-muted-foreground">{t(description)}</p>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
