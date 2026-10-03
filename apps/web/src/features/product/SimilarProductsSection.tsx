import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getSimilarProducts } from '@/api/products';
import type { VariantProductList } from '@/api/products';
import { ProductCard } from '@/components/ProductCard';
import { ProductGrid } from '@/components/ProductGrid';
import { productMessages } from '@shop/localisation/messages/product';
import { useLocalisation } from '@/i18n/LocaleContext';

interface SimilarProductsSectionProps {
  productId: string;
  isCartAvailable: boolean;
  isAdding: (productId: string) => boolean;
  onAddToCart: (productId: string, variantId?: number) => Promise<boolean>;
}

function SimilarProductsHeading({ label }: { label: string }) {
  return (
    <h2 id="similar-products-heading" className="section-heading">
      {label}
    </h2>
  );
}

export function SimilarProductsSection({
  productId,
  isCartAvailable,
  isAdding,
  onAddToCart,
}: SimilarProductsSectionProps) {
  const [products, setProducts] = useState<VariantProductList['items'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);
  const { translate } = useLocalisation();

  useEffect(() => {
    const controller = new AbortController();
    let current = true;

    setProducts(null);
    setError(null);

    getSimilarProducts(productId, controller.signal)
      .then((response) => {
        if (!current) return;
        setProducts(Array.isArray(response) ? response.slice(0, 5) : []);
      })
      .catch(() => {
        if (!current || controller.signal.aborted) return;
        setError(translate(productMessages, 'product.couldNotLoadSimilar'));
      });

    return () => {
      current = false;
      controller.abort();
    };
  }, [productId, requestVersion, translate]);

  if (products === null && error === null) {
    return (
      <section className="mt-16" aria-labelledby="similar-products-heading" aria-busy="true">
        <SimilarProductsHeading label={translate(productMessages, 'product.similarMaterials')} />
        <p className="text-sm text-muted-foreground">
          {translate(productMessages, 'product.findingSimilar')}
        </p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="mt-16" aria-labelledby="similar-products-heading">
        <SimilarProductsHeading label={translate(productMessages, 'product.similarMaterials')} />
        <p role="alert" className="text-sm text-muted-foreground">
          {translate(productMessages, 'product.couldNotLoadSimilar')}
        </p>
        <button
          type="button"
          className="mt-2 rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setRequestVersion((version) => version + 1)}
        >
          {translate(productMessages, 'product.tryAgain')}
        </button>
      </section>
    );
  }

  if (!products || products.length === 0) {
    return (
      <section className="mt-16" aria-labelledby="similar-products-heading">
        <SimilarProductsHeading label={translate(productMessages, 'product.similarMaterials')} />
        <p className="mt-2 text-sm text-muted-foreground">
          {translate(productMessages, 'product.noSimilar')}
        </p>
      </section>
    );
  }

  return (
    <section className="mt-16" aria-labelledby="similar-products-heading">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="section-eyebrow">
            {translate(productMessages, 'product.chosenSharedTraits')}
          </p>
          <h2 id="similar-products-heading" className="section-heading mt-2">
            {translate(productMessages, 'product.similarMaterials')}
          </h2>
        </div>
        <Link to="/catalog" className="section-link">
          {translate(productMessages, 'product.browseAllMaterials')}
        </Link>
      </div>
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
    </section>
  );
}
