import type { Product, ProductSpecification } from '@shop/contracts/products';
import { productMessages } from '@shop/localisation/messages/product';
import { useLocalisation } from '@/i18n/LocaleContext';

interface ProductSpecificationsProps {
  specificationGroups: Product['specificationGroups'];
}

function hasDisplayValue(specification: ProductSpecification): boolean {
  return Boolean(specification.label?.trim() && specification.value?.trim());
}

export function ProductSpecifications({ specificationGroups }: ProductSpecificationsProps) {
  const { translate } = useLocalisation();
  const groups = specificationGroups
    .map((group) => ({
      ...group,
      specifications: group.specifications.filter(hasDisplayValue),
    }))
    .filter((group) => group.label?.trim() && group.specifications.length > 0);

  if (groups.length === 0) return null;

  return (
    <section
      aria-labelledby="product-specifications-heading"
      className="rounded-2xl border bg-surface-raised p-6 sm:p-8"
    >
      <h2 id="product-specifications-heading" className="text-2xl font-semibold tracking-tight">
        {translate(productMessages, 'product.specifications')}
      </h2>
      <div className="mt-6 grid gap-8">
        {groups.map((group) => (
          <section key={group.key} aria-labelledby={`product-specifications-${group.key}`}>
            <h3 id={`product-specifications-${group.key}`} className="text-lg font-semibold">
              {group.label}
            </h3>
            <dl className="mt-3 divide-y">
              {group.specifications.map((specification, index) => (
                <div
                  key={`${group.key}:${specification.key}:${index}`}
                  className="grid gap-1 py-4 first:pt-0 last:pb-0 sm:grid-cols-[minmax(10rem,1fr)_2fr]"
                >
                  <dt className="font-medium">{specification.label}</dt>
                  <dd className="text-muted-foreground">{specification.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </section>
  );
}
