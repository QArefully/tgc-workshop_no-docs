import { Link } from 'react-router-dom';
import type { Product } from '@shop/contracts/products';
import { ProductCard } from '@/components/ProductCard';
import { ProductGrid } from '@/components/ProductGrid';
import { Button } from '@/components/ui/button';
import { useLocalisation } from '@/i18n/LocaleContext';
import { discoveryMessages } from '@shop/localisation/messages/discovery';
import { webMessages } from '@shop/localisation/messages/webShell';
import { commonMessages } from '@shop/localisation/messages/common';

interface Props {
  eyebrow: string;
  title: string;
  href: string;
  products: Product[];
  isLoading: boolean;
  error?: string | null;
  onRetry: () => void;
  isCartAvailable: boolean;
  isAdding: (id: string) => boolean;
  onAddToCart: (id: string) => Promise<boolean>;
}

export function ProductShelf({
  eyebrow,
  title,
  href,
  products,
  isLoading,
  error,
  onRetry,
  isCartAvailable,
  isAdding,
  onAddToCart,
}: Props) {
  const { translate } = useLocalisation();
  const t = (key: keyof typeof discoveryMessages) => translate(discoveryMessages, key);
  const headingId = `${title.replaceAll(' ', '-').toLowerCase()}-heading`;
  return (
    <section aria-labelledby={headingId}>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="section-eyebrow">{eyebrow}</p>
          <h2 id={headingId} className="section-heading mt-2">
            {title}
          </h2>
        </div>
        <Link to={href} className="section-link">
          {translate(discoveryMessages, 'catalog.browseAll')} →
        </Link>
      </div>
      {error ? (
        <p
          role="status"
          className="rounded-xl border bg-surface-raised p-5 text-sm text-muted-foreground"
        >
          {translate(webMessages, 'home.collectionUnavailable')}{' '}
          <Button variant="link" className="h-auto px-0 py-0 font-semibold" onClick={onRetry}>
            {translate(commonMessages, 'common.retry')}
          </Button>{' '}
          <Link className="font-semibold text-primary underline" to={href}>
            {t('home.browseCatalog')}
          </Link>
        </p>
      ) : isLoading ? (
        <ProductShelfSkeleton />
      ) : products.length === 0 ? (
        <p className="rounded-xl border bg-surface-raised p-5 text-sm text-muted-foreground">
          {t('home.noProducts')}{' '}
          <Link className="font-semibold text-primary underline" to={href}>
            {t('home.browseCatalog')}
          </Link>
        </p>
      ) : (
        <ProductGrid>
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              isCartAvailable={isCartAvailable}
              isAdding={isAdding(product.id)}
              onAddToCart={onAddToCart}
            />
          ))}
        </ProductGrid>
      )}
    </section>
  );
}

function ProductShelfSkeleton() {
  const { translate } = useLocalisation();
  return (
    <div
      aria-label={translate(discoveryMessages, 'catalog.loadingMaterials')}
      className="grid grid-cols-1 gap-x-4 gap-y-6 min-[440px]:grid-cols-2 lg:grid-cols-4 min-[1440px]:grid-cols-5"
    >
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="animate-pulse">
          <div className="aspect-4/5 rounded-2xl bg-muted" />
          <div className="mt-4 h-3 w-1/3 rounded bg-muted" />
          <div className="mt-2 h-5 w-3/4 rounded bg-muted" />
          <div className="mt-4 h-5 w-1/2 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}
