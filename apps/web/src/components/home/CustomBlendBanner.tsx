import { ArrowRight, FlaskConical } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLocalisation } from '@/i18n/LocaleContext';
import { discoveryMessages } from '@shop/localisation/messages/discovery';

/**
 * Decorative ratio arcs. Cropped by the banner edge so the artwork reads as a fragment of
 * something larger rather than a framed illustration.
 */
function RatioArcs() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 400 400"
      className="pointer-events-none absolute top-1/2 -right-32 hidden size-[26rem] -translate-y-1/2 sm:block"
    >
      <g fill="none" strokeLinecap="round" strokeWidth="26">
        <circle
          cx="200"
          cy="200"
          r="60"
          stroke="var(--custom-blend-segment-1)"
          strokeDasharray="250 130"
          transform="rotate(-30 200 200)"
        />
        <circle
          cx="200"
          cy="200"
          r="105"
          stroke="var(--custom-blend-segment-2)"
          strokeDasharray="430 230"
          transform="rotate(60 200 200)"
        />
        <circle
          cx="200"
          cy="200"
          r="150"
          stroke="var(--custom-blend-segment-3)"
          strokeDasharray="330 610"
          transform="rotate(150 200 200)"
        />
        <circle
          cx="200"
          cy="200"
          r="150"
          stroke="var(--custom-blend-segment-4)"
          strokeDasharray="180 760"
          opacity="0.8"
          transform="rotate(-70 200 200)"
        />
      </g>
    </svg>
  );
}

export function CustomBlendBanner() {
  const { translate } = useLocalisation();
  const t = (key: keyof typeof discoveryMessages) => translate(discoveryMessages, key);
  return (
    <Link
      to="/custom-blend"
      aria-label={t('home.customAria')}
      className="custom-blend-banner relative flex flex-col items-start gap-6 overflow-hidden rounded-2xl px-7 py-9 sm:flex-row sm:items-center sm:justify-between sm:gap-10 sm:px-11"
    >
      <RatioArcs />
      <div className="relative z-10">
        <p className="flex items-center gap-2 text-xs font-bold tracking-[0.18em] uppercase opacity-70">
          <FlaskConical className="size-4" aria-hidden="true" />
          {t('home.customLabel')}
        </p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight">{t('home.customTitle')}</h2>
        <p className="mt-2 max-w-xl text-sm leading-6 opacity-80">{t('home.customDescription')}</p>
      </div>
      <span className="relative z-10 inline-flex flex-none items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background transition-transform duration-[var(--custom-blend-motion-duration)] hover:-translate-y-0.5 sm:mr-44">
        {t('home.customCta')}
        <ArrowRight className="size-4" aria-hidden="true" />
      </span>
    </Link>
  );
}
