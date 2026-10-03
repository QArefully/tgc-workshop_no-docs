import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Button } from '@/components/ui/button';
import { useCartContext } from '@/hooks/CartContext';
import { useBundles } from '@/hooks/useBundles';
import { useLocalisation } from '@/i18n/LocaleContext';
import { discoveryMessages } from '@shop/localisation/messages/discovery';
import { BundleCard } from './BundleCard';

export function BundlesPage() {
  const { translate } = useLocalisation();
  const t = (key: keyof typeof discoveryMessages) => translate(discoveryMessages, key);
  const { bundles, error: loadError, isLoading, refetch } = useBundles();
  const { addBundle, error: cartError, isActionPending, isCartAvailable } = useCartContext();

  if (isLoading && bundles.length === 0) return <LoadingSpinner />;
  const displayLoadError =
    loadError === 'Failed to load bundles' ? t('bundle.loadError') : loadError;
  if (displayLoadError && bundles.length === 0)
    return (
      <div
        role="alert"
        className="flex flex-col items-center justify-center gap-4 py-12 text-center"
      >
        <p className="text-destructive">{displayLoadError}</p>
        <Button size="sm" onClick={() => void refetch()}>
          {t('bundle.tryAgain')}
        </Button>
      </div>
    );

  return (
    <section className="mx-auto max-w-5xl space-y-7 pb-12">
      <header className="max-w-2xl">
        <p className="section-eyebrow">{t('bundle.eyebrow')}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          {t('bundle.title')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('bundle.description')}</p>
      </header>
      {displayLoadError && (
        <p role="alert" className="text-sm text-destructive">
          {displayLoadError}
        </p>
      )}
      {bundles.length === 0 ? (
        <p className="rounded-xl border bg-surface-raised p-6 text-muted-foreground">
          {t('bundle.empty')}
        </p>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {bundles.map((bundle) => (
            <BundleCard
              key={bundle.id}
              bundle={bundle}
              isCartAvailable={isCartAvailable}
              isAdding={isActionPending(`bundle:${bundle.id}`, 'bundle-add')}
              error={cartError}
              onAdd={addBundle}
            />
          ))}
        </div>
      )}
    </section>
  );
}
