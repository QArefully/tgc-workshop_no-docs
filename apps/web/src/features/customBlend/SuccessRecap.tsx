import { Link } from 'react-router-dom';
import type { CustomBlendOption } from '@shop/contracts/custom-blends';
import { Button } from '@/components/ui/button';
import { customBlendMadeToOrderNote } from './CustomBlendPackaging';
import { CustomBlendPreview, type PreviewIngredient } from './CustomBlendPreview';
import { useLocalisation } from '@/i18n/LocaleContext';
import { customBlendMessages } from '@shop/localisation/messages/customBlend';

export function SuccessRecap({
  result,
  base,
  basePercentage,
  ingredients,
  authoritativeConfigKey,
}: {
  result: 'created' | 'replaced';
  base: CustomBlendOption;
  basePercentage: number;
  ingredients: readonly PreviewIngredient[];
  /** Present only when the completed operation returned a new server-issued key. */
  authoritativeConfigKey?: string;
}) {
  const { country, translate, formatCount } = useLocalisation();
  return (
    <div className="grid max-w-3xl gap-6 pb-12">
      <header>
        <p className="custom-blend-eyebrow-rule section-eyebrow">
          {translate(customBlendMessages, 'customBlend.name')}
        </p>
        <h1 className="section-heading mt-2">
          {translate(
            customBlendMessages,
            result === 'created' ? 'customBlend.success.created' : 'customBlend.success.updated',
          )}
        </h1>
      </header>
      <CustomBlendPreview
        base={base}
        basePercentage={basePercentage}
        ingredients={ingredients}
        authoritativeConfigKey={authoritativeConfigKey}
      />
      <section
        aria-labelledby="blend-recap-heading"
        className="custom-blend-surface rounded-xl p-4"
      >
        <h2 id="blend-recap-heading" className="font-semibold">
          {translate(customBlendMessages, 'customBlend.blendRecap')}
        </h2>
        <p className="mt-2 text-sm">
          {formatCount(basePercentage)}% {base.productName}
        </p>
        <ul className="mt-2 grid gap-1 text-sm text-muted-foreground">
          {ingredients.map(({ option, percentage }) => (
            <li key={option.variant.variantId}>
              {formatCount(percentage)}% {option.productName}
            </li>
          ))}
        </ul>
      </section>
      <p className="custom-blend-notice rounded-xl p-3 text-sm">
        {customBlendMadeToOrderNote(country)}
      </p>
      <div className="flex flex-wrap gap-3">
        <Button nativeButton={false} render={<Link to="/cart" />}>
          {translate(customBlendMessages, 'customBlend.viewCart')}
        </Button>
        <Button variant="outline" nativeButton={false} render={<Link to="/catalog" />}>
          {translate(customBlendMessages, 'customBlend.keepShopping')}
        </Button>
      </div>
    </div>
  );
}
