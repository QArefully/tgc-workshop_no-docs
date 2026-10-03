import { Link } from 'react-router-dom';
import { useLocalisation } from '@/i18n/LocaleContext';
import { discoveryMessages } from '@shop/localisation/messages/discovery';

export function PromoBanner() {
  const { translate } = useLocalisation();
  const t = (key: keyof typeof discoveryMessages) => translate(discoveryMessages, key);
  return (
    <section className="grid overflow-hidden rounded-2xl border-2 border-foreground bg-sale text-sale-foreground sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="px-7 py-9 sm:px-10">
        <p className="text-xs font-bold uppercase tracking-[0.18em] opacity-80">
          {t('home.promoEyebrow')}
        </p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight">{t('home.promoTitle')}</h2>
        <p className="mt-2 max-w-2xl text-sm opacity-85">{t('home.promoDescription')}</p>
      </div>
      <Link
        to="/catalog?onSale=true&sort=bestselling"
        className="m-6 mt-0 rounded-full bg-background px-6 py-3 text-center text-sm font-semibold text-foreground transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background sm:mt-6"
      >
        {t('home.promoCta')}
      </Link>
    </section>
  );
}
