import { useLocalisation } from '@/i18n/LocaleContext';
import { customBlendMessages } from '@shop/localisation/messages/customBlend';

export function RatioGauge({
  basePercentage,
  totalPercentage,
  ingredientCount,
  isValid,
}: {
  basePercentage: number;
  totalPercentage: number;
  ingredientCount: number;
  isValid: boolean;
}) {
  const { translate, formatCount } = useLocalisation();
  return (
    <section aria-labelledby="custom-blend-summary-heading">
      <h2 id="custom-blend-summary-heading" className="text-xl font-semibold">
        {translate(customBlendMessages, 'customBlend.blendRecap')}
      </h2>
      <div
        aria-hidden="true"
        className={`custom-blend-gauge mt-2 ${isValid ? '' : 'custom-blend-gauge--invalid'}`}
      >
        <div
          className="custom-blend-segment h-2"
          style={{ width: `${Math.max(0, Math.min(100, totalPercentage))}%` }}
        />
      </div>
      <p className="mt-2 text-sm" aria-live="polite" aria-atomic="true">
        {translate(customBlendMessages, 'customBlend.ratioSummary', {
          baseLabel: formatCount(basePercentage),
          totalLabel: formatCount(totalPercentage),
          count: ingredientCount,
          countLabel: formatCount(ingredientCount),
        })}
      </p>
    </section>
  );
}
