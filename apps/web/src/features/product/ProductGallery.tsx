import type { ProductWithVariants } from '@shop/contracts/products';

import { ProductMedia } from '@/components/ProductMedia';
import { productMessages } from '@shop/localisation/messages/product';
import { useLocalisation } from '@/i18n/LocaleContext';

interface ProductGalleryProps {
  product: ProductWithVariants;
}

export function ProductGallery({ product }: ProductGalleryProps) {
  const { translate } = useLocalisation();
  return (
    <section
      aria-label={translate(productMessages, 'product.images', { name: product.name })}
      className="min-w-0"
    >
      <div className="aspect-square overflow-hidden rounded-2xl border bg-surface-soft">
        <ProductMedia product={product} className="h-full w-full object-cover" />
      </div>
    </section>
  );
}
