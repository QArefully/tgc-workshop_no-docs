import { Outlet } from 'react-router-dom';
import { useCountry } from '@/hooks/CountryContext';
import { useMessages } from '@/i18n/LocaleContext';
import { adminDiagnosticsMessages } from '@shop/localisation/messages/adminDiagnostics';
import { AdminNav } from './AdminNav';

/** Shared container for protected administration routes. */
export function AdminLayout() {
  const { activeCountry } = useCountry();
  const t = useMessages(adminDiagnosticsMessages);

  return (
    <section className="mx-auto max-w-6xl space-y-6" aria-labelledby="admin-shell-heading">
      <header>
        <p className="section-eyebrow">{t('admin.shell.eyebrow')}</p>
        <h1 id="admin-shell-heading" className="section-heading mt-2">
          {t('admin.shell.heading')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground" data-testid="admin-standing-country">
          {t('admin.shell.standingCountry', { country: activeCountry })}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{t('admin.shell.globalSections')}</p>
      </header>
      <AdminNav />
      {/*
       * Route pages own their fetch effects. Remounting the outlet when the standing country
       * changes makes every section issue a fresh server-authorized request without introducing
       * client-side filtering or section-specific country state.
       */}
      <div key={activeCountry} data-testid="admin-country-outlet">
        <Outlet />
      </div>
    </section>
  );
}
