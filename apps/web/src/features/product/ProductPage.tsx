import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ProductWithVariants } from '@shop/contracts/products';
import type { PublicErrorCode } from '@shop/contracts/public-errors';
import type { MessageCatalog, MessageParams } from '@shop/localisation';
import { ApiError, type ApiErrorMeta } from '@/api/client';
import { getProduct } from '@/api/products';
import { ErrorMessage } from '@/components/ErrorMessage';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ProductBundlesSection } from '@/features/product/ProductBundlesSection';
import { useCartContext } from '@/hooks/CartContext';
import { ProductContextLinks } from './ProductContextLinks';
import { ProductDetails } from './ProductDetails';
import { ProductGallery } from './ProductGallery';
import { ProductPurchasePanel } from './ProductPurchasePanel';
import { ProductSpecifications } from './ProductSpecifications';
import { ReviewsSection } from './ReviewsSection';
import { SimilarProductsSection } from './SimilarProductsSection';
import { apiErrors } from '@shop/localisation/messages/apiErrors';
import { productMessages } from '@shop/localisation/messages/product';
import { useLocalisation } from '@/i18n/LocaleContext';

type ProductMessageKey = keyof typeof productMessages;
type ProductErrorState = {
  readonly code: PublicErrorCode | null;
  readonly meta: ApiErrorMeta | null;
  readonly key: ProductMessageKey;
  readonly params?: MessageParams;
};

function safeMessageParams(meta: ApiErrorMeta | null): MessageParams {
  if (meta === null || typeof meta !== 'object') return {};
  const params: Record<string, string | number | bigint> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint')
      params[key] = value;
  }
  return params;
}

function localizeProductError(
  state: ProductErrorState | null,
  translate: (catalog: MessageCatalog, key: string, params?: MessageParams) => string,
): string | null {
  if (state === null) return null;
  if (state.code !== null) {
    try {
      return translate(apiErrors, state.code, safeMessageParams(state.meta));
    } catch {
      // Stale/malformed descriptors use safe P17 copy.
    }
  }
  return translate(productMessages, state.key, state.params);
}

function errorState(error: unknown, fallback: ProductMessageKey): ProductErrorState {
  if (error instanceof ApiError && error.code !== null) {
    return { code: error.code, meta: error.meta, key: fallback };
  }
  // Network, contract, legacy, and unknown failures never expose Error.message.
  return { code: null, meta: null, key: fallback };
}

export function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const [product, setProduct] = useState<ProductWithVariants | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorStateValue, setErrorStateValue] = useState<ProductErrorState | null>(null);
  const [actionErrorState, setActionErrorState] = useState<ProductErrorState | null>(null);
  const addInFlightProductIdsRef = useRef(new Set<string>());
  const activeProductIdRef = useRef<string | undefined>(id);
  const {
    addItem,
    isCartAvailable,
    isActionPending,
    error: cartError,
    errorState: cartErrorState,
  } = useCartContext();
  const { translate } = useLocalisation();

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    activeProductIdRef.current = id;
    setIsLoading(true);
    setErrorStateValue(null);
    setProduct(null);
    setActionErrorState(null);

    if (!id) {
      setErrorStateValue({ code: null, meta: null, key: 'product.notFound' });
      setIsLoading(false);
      return;
    }

    getProduct(id, controller.signal)
      .catch((loadError: unknown) => {
        if (loadError instanceof ApiError && loadError.status === 404) return null;
        throw loadError;
      })
      .then((productResult) => {
        if (cancelled) return;
        if (!productResult) setErrorStateValue({ code: null, meta: null, key: 'product.notFound' });
        else setProduct(productResult);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setErrorStateValue(errorState(loadError, 'product.couldNotLoad'));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [id]);

  const error = localizeProductError(errorStateValue, translate);
  const actionError = localizeProductError(actionErrorState, translate);

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message={error} />;
  if (!product) return <ErrorMessage message={translate(productMessages, 'product.notFound')} />;

  const handleAddToCart = async (variantId: number, quantity: number): Promise<void> => {
    const productId = product.id;
    if (addInFlightProductIdsRef.current.has(productId)) return;
    addInFlightProductIdsRef.current.add(productId);
    setActionErrorState(null);
    try {
      if (
        !(await addItem(productId, variantId, quantity)) &&
        activeProductIdRef.current === productId
      ) {
        setActionErrorState({ code: null, meta: null, key: 'product.couldNotAdd' });
      }
    } finally {
      addInFlightProductIdsRef.current.delete(productId);
    }
  };

  return (
    <div className="pb-8">
      <nav
        aria-label={translate(productMessages, 'product.breadcrumb')}
        className="mb-6 flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
      >
        <Link
          to="/catalog"
          className="rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {translate(productMessages, 'product.breadcrumbAllMaterials')}
        </Link>
        <span aria-hidden="true">/</span>
        <Link
          to={`/catalog?category=${encodeURIComponent(product.category)}`}
          className="rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {product.category}
        </Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page" className="text-foreground">
          {product.name}
        </span>
      </nav>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)] xl:gap-12">
        <ProductGallery product={product} />
        <ProductPurchasePanel
          product={product}
          isCartAvailable={isCartAvailable}
          isAdding={isActionPending(product.id, 'add')}
          actionError={actionError}
          belowMoqError={
            cartErrorState === undefined
              ? cartError?.toLowerCase().includes('minimum order quantity')
                ? cartError
                : null
              : cartErrorState?.code === 'BELOW_MOQ'
                ? cartError
                : null
          }
          onAddToCart={handleAddToCart}
        />
      </div>

      <div className="mt-12 grid gap-6">
        <ProductDetails description={product.description} categoryFacts={product.categoryFacts} />
        <ProductSpecifications specificationGroups={product.specificationGroups} />
        <ProductContextLinks packagingQuantity={product.packaging?.quantity} />
      </div>

      <ProductBundlesSection productId={product.id} />
      <ReviewsSection productId={product.id} />
      <SimilarProductsSection
        productId={product.id}
        isCartAvailable={isCartAvailable}
        isAdding={(productId) => isActionPending(productId, 'add')}
        onAddToCart={(productId, variantId) => addItem(productId, variantId)}
      />
    </div>
  );
}
