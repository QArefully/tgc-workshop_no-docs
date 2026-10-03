import { ArrowRight, Package } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLocalisation } from '@/i18n/LocaleContext';
import { discoveryMessages } from '@shop/localisation/messages/discovery';

/** Sample of the seeded curated bundles, shown as decorative artwork only. */
const stackedSets = [
  { label: 'bundle.stack.baking' as const, count: 4 },
  { label: 'bundle.stack.garden' as const, count: 3 },
  { label: 'bundle.stack.cleaning' as const, count: 3 },
];

export function BundleBanner() {
  const { translate, formatCount } = useLocalisation();
  const t = (key: keyof typeof discoveryMessages, params?: Record<string, string | number>) =>
    translate(discoveryMessages, key, params);
  return (
    <Link
      to="/bundles"
      aria-label={t('bundle.bannerLabel')}
      className="group grid overflow-hidden rounded-2xl border-2 border-foreground bg-secondary text-secondary-foreground shadow-sm transition-transform hover:-translate-y-0.5 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:grid-cols-[1.1fr_0.9fr]"
    >
      <div className="px-7 py-9 sm:px-10">
        <p className="flex items-center gap-2 text-xs font-bold tracking-[0.18em] uppercase opacity-70">
          <Package className="size-4" aria-hidden="true" />
          {t('bundle.bannerEyebrow')}
        </p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight">{t('bundle.bannerTitle')}</h2>
        <p className="mt-2 max-w-xl text-sm leading-6 opacity-80">
          {t('bundle.bannerDescription')}
        </p>
        <span className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors group-hover:bg-primary/85">
          {t('bundle.bannerBrowse')}
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
        </span>
      </div>
      <div
        aria-hidden="true"
        className="relative hidden content-center gap-2 bg-surface-soft p-6 sm:grid sm:p-8"
      >
        {stackedSets.map((set) => (
          <div
            key={set.label}
            className="border border-foreground/25 bg-background/85 px-4 py-2.5 shadow-sm transition-transform group-hover:translate-x-1"
          >
            <p className="text-sm font-semibold tracking-tight text-foreground">{t(set.label)}</p>
            <p className="text-xs text-muted-foreground">
              {t('bundle.bannerMaterials', {
                count: set.count,
                displayCount: formatCount(set.count),
              })}
            </p>
          </div>
        ))}
      </div>
    </Link>
  );
}
