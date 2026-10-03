import { useEffect, useMemo, useState } from 'react';
import { getBestsellers, getCategories, getProducts } from '@/api/products';
import { BundleBanner } from '@/components/home/BundleBanner';
import { CategoryTiles } from '@/components/home/CategoryTiles';
import { CustomBlendBanner } from '@/components/home/CustomBlendBanner';
import { HeroSection } from '@/components/home/HeroSection';
import { ProductShelf } from '@/components/home/ProductShelf';
import { PromoBanner } from '@/components/home/PromoBanner';
import { useCartContext } from '@/hooks/CartContext';
import type { Product } from '@shop/contracts/products';
import { useLocalisation } from '@/i18n/LocaleContext';
import { webMessages } from '@shop/localisation/messages/webShell';

interface ShelfState {
  products: Product[];
  isLoading: boolean;
  error: string | null;
}
const initialShelf: ShelfState = { products: [], isLoading: true, error: null };

export function withoutProducts(products: Product[], excludedIds: ReadonlySet<string>): Product[] {
  return products.filter((product) => !excludedIds.has(product.id));
}

export function HomePage() {
  const { addItem, isCartAvailable, isActionPending } = useCartContext();
  const { translate } = useLocalisation();
  const t = (key: keyof typeof webMessages) => translate(webMessages, key);
  const [bestsellers, setBestsellers] = useState<ShelfState>(initialShelf);
  const [newest, setNewest] = useState<ShelfState>(initialShelf);
  const [categories, setCategories] = useState<string[]>([]);
  const [isCategoriesLoading, setIsCategoriesLoading] = useState(true);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [bestsellersRetry, setBestsellersRetry] = useState(0);
  const [newestRetry, setNewestRetry] = useState(0);
  const [categoriesRetry, setCategoriesRetry] = useState(0);

  // Async state keeps a stable lookup key; rendering resolves it for the active country.
  const message = () => 'home.collectionUnavailable';

  useEffect(() => {
    let cancelled = false;

    setBestsellers((current) => ({ ...current, isLoading: true, error: null }));
    void getBestsellers()
      .then((products) => {
        if (!cancelled)
          setBestsellers({ products: products.slice(0, 5), isLoading: false, error: null });
      })
      .catch(() => {
        if (!cancelled) setBestsellers({ products: [], isLoading: false, error: message() });
      });

    return () => {
      cancelled = true;
    };
  }, [bestsellersRetry]);

  useEffect(() => {
    let cancelled = false;

    setNewest((current) => ({ ...current, isLoading: true, error: null }));
    void getProducts({ sort: 'newest', pageSize: 10 })
      .then((response) => {
        if (!cancelled) setNewest({ products: response.items, isLoading: false, error: null });
      })
      .catch(() => {
        if (!cancelled) setNewest({ products: [], isLoading: false, error: message() });
      });

    return () => {
      cancelled = true;
    };
  }, [newestRetry]);

  useEffect(() => {
    let cancelled = false;

    setIsCategoriesLoading(true);
    setCategoriesError(null);
    void getCategories()
      .then((result) => {
        if (!cancelled) setCategories(result);
      })
      .catch(() => {
        if (!cancelled) setCategoriesError(message());
      })
      .finally(() => {
        if (!cancelled) setIsCategoriesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [categoriesRetry]);

  const newArrivals = useMemo(
    () =>
      withoutProducts(
        newest.products,
        new Set(bestsellers.products.map((product) => product.id)),
      ).slice(0, 5),
    [bestsellers.products, newest.products],
  );

  return (
    <div className="space-y-16 pb-12 lg:space-y-20">
      <HeroSection />
      <CustomBlendBanner />
      <BundleBanner />
      <section
        aria-label={t('home.storeAssurances')}
        className="grid divide-y rounded-2xl border bg-surface-raised text-center shadow-sm sm:grid-cols-3 sm:divide-x sm:divide-y-0"
      >
        <p className="p-4 text-sm">
          <strong className="block text-foreground">{t('home.clearProductData')}</strong>
          <span className="text-muted-foreground">{t('home.specificationsAndPacks')}</span>
        </p>
        <p className="p-4 text-sm">
          <strong className="block text-foreground">{t('home.supplyReadyCatalogue')}</strong>
          <span className="text-muted-foreground">{t('home.availabilitySignals')}</span>
        </p>
        <p className="p-4 text-sm">
          <strong className="block text-foreground">{t('home.demoOrdering')}</strong>
          <span className="text-muted-foreground">{t('home.noRealPayment')}</span>
        </p>
      </section>
      <CategoryTiles
        categories={categories}
        isLoading={isCategoriesLoading}
        error={categoriesError}
        onRetry={() => setCategoriesRetry((attempt) => attempt + 1)}
      />
      <ProductShelf
        eyebrow={t('home.mostRequested')}
        title={t('home.bestsellers')}
        href="/catalog?sort=bestselling"
        products={bestsellers.products}
        isLoading={bestsellers.isLoading}
        error={bestsellers.error}
        onRetry={() => setBestsellersRetry((attempt) => attempt + 1)}
        isCartAvailable={isCartAvailable}
        isAdding={(id) => isActionPending(id, 'add')}
        onAddToCart={addItem}
      />
      <PromoBanner />
      <ProductShelf
        eyebrow={t('home.recentBatches')}
        title={t('home.justIn')}
        href="/catalog?sort=newest"
        products={newArrivals}
        isLoading={newest.isLoading}
        error={newest.error}
        onRetry={() => setNewestRetry((attempt) => attempt + 1)}
        isCartAvailable={isCartAvailable}
        isAdding={(id) => isActionPending(id, 'add')}
        onAddToCart={addItem}
      />
    </div>
  );
}
