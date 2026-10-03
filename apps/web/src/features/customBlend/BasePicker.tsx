import { useEffect, useMemo, useRef, useState } from 'react';
import type { CustomBlendBaseListQuery, CustomBlendOption } from '@shop/contracts/custom-blends';

import { getCustomBlendBases } from '@/api/customBlends';
import { ApiError, type ApiErrorMeta } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PackagingArtwork } from '@/components/packaging/PackagingArtwork';
import { resolveCatalogPackagingPalette } from '@/components/packaging/catalogPackagingPalettes';
import { resolvePackagingSpec } from '@/components/packaging/packagingSpec';
import { useLocalisation } from '@/i18n/LocaleContext';
import { apiErrors } from '@shop/localisation/messages/apiErrors';
import { commonMessages } from '@shop/localisation/messages/common';
import { customBlendMessages } from '@shop/localisation/messages/customBlend';

function optionPackagingProduct(option: CustomBlendOption) {
  return {
    id: option.productId,
    name: option.productName,
    category: option.category,
    consumptionClassification: option.consumptionClassification,
    categoryFacts: option.categoryFacts,
    mixingGroup: option.mixingGroup,
  };
}

/**
 * Fetches the complete server-approved base list in stable page order. The first request keeps the
 * API's existing default page size; subsequent requests use the server-advertised size so this
 * remains correct if the endpoint's default changes. The caller owns stale-result checks while
 * this helper keeps cancellation checks between pages.
 */
async function getAllBaseOptions(
  request: CustomBlendBaseListQuery,
  signal: AbortSignal,
): Promise<CustomBlendOption[]> {
  const firstPage = await getCustomBlendBases(request, signal);
  if (signal.aborted) throw new Error('Custom Blend base request was aborted.');

  const pageCount = Math.ceil(firstPage.total / firstPage.pageSize);
  const pages: CustomBlendOption[][] = [firstPage.items];
  for (let page = 2; page <= pageCount; page += 1) {
    if (signal.aborted) throw new Error('Custom Blend base request was aborted.');
    const nextPage = await getCustomBlendBases(
      { ...request, page, pageSize: firstPage.pageSize },
      signal,
    );
    if (signal.aborted) throw new Error('Custom Blend base request was aborted.');
    pages.push(nextPage.items);
  }

  return pages.flat();
}

/** Compact, option-backed confirmation of the URL-selected base material. */
export function SelectedBaseChip({
  base,
  onChange,
}: {
  base: CustomBlendOption;
  onChange: () => void;
}) {
  const { translate } = useLocalisation();
  const product = optionPackagingProduct(base);
  const hasArtwork = resolveCatalogPackagingPalette(product) !== undefined;

  return (
    <div className="custom-blend-tile mt-3 flex items-center gap-3 rounded-lg p-2.5">
      {hasArtwork ? (
        <PackagingArtwork
          name={base.productName}
          spec={resolvePackagingSpec({ product, variant: base.variant })}
          mark="CB"
          consumptionLabel={base.consumptionClassification}
          ariaLabel={`${base.productName} ${translate(customBlendMessages, 'customBlend.packaging')}`}
          className="h-14 w-14 shrink-0"
        />
      ) : (
        <div
          aria-label={`${base.productName} ${translate(customBlendMessages, 'customBlend.packagingUnavailableAria')}`}
          className="grid h-14 w-14 shrink-0 place-items-center rounded border bg-muted px-1 text-center text-[10px] text-muted-foreground"
        >
          {translate(customBlendMessages, 'customBlend.packagingUnavailable')}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{base.productName}</p>
        <p className="text-xs text-muted-foreground">{base.variant.label}</p>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onChange}>
        {translate(customBlendMessages, 'customBlend.changeBase')}
      </Button>
    </div>
  );
}

type BasePickerError = {
  readonly code: ApiError['code'];
  readonly meta: ApiErrorMeta | null;
};

function errorState(error: unknown): BasePickerError {
  if (error instanceof ApiError && error.code !== null) {
    return { code: error.code, meta: error.meta };
  }
  return { code: null, meta: null };
}

function safeErrorParams(meta: ApiErrorMeta | null): Record<string, string | number | bigint> {
  if (!meta) return {};
  return Object.fromEntries(
    Object.entries(meta).filter(
      ([, value]) =>
        typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint',
    ),
  ) as Record<string, string | number | bigint>;
}

function baseErrorMessage(
  error: BasePickerError,
  translate: ReturnType<typeof useLocalisation>['translate'],
): string {
  if (error.code !== null) {
    try {
      return translate(apiErrors, error.code, safeErrorParams(error.meta));
    } catch {
      // Unknown/stale codes intentionally use the feature-owned safe fallback below.
    }
  }
  return translate(customBlendMessages, 'customBlend.invalidBase');
}

/**
 * Lists only the server-approved 25 kg base lots. The API owns eligibility and country/category
 * policy; this component only forwards search filters and renders the returned options.
 */
export function BasePicker({
  onSelectBase,
  suppressError = false,
}: {
  onSelectBase: (variantId: number) => void;
  /** Parent-level URL errors already explain why a deep link cannot be used. */
  suppressError?: boolean;
}) {
  const { activeCountry: requestCountry, translate } = useLocalisation();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [items, setItems] = useState<readonly CustomBlendOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<BasePickerError | null>(null);
  const [fulfilledKey, setFulfilledKey] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const [retryToken, setRetryToken] = useState(0);

  const requestKey = useMemo(
    () => JSON.stringify([requestCountry, query.trim(), category.trim()]),
    [category, query, requestCountry],
  );
  const request = useMemo(() => {
    const trimmedQuery = query.trim();
    const trimmedCategory = category.trim();
    return {
      ...(trimmedQuery ? { q: trimmedQuery } : {}),
      ...(trimmedCategory ? { category: trimmedCategory } : {}),
    };
  }, [category, query]);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    const controller = new AbortController();
    const isCurrent = () => requestId === requestIdRef.current && !controller.signal.aborted;

    // A new query must not keep showing the previous server result while it is in flight.
    setItems([]);
    setError(null);
    setFulfilledKey(null);
    setIsLoading(true);

    let basesPromise: Promise<CustomBlendOption[]>;
    try {
      basesPromise = getAllBaseOptions(request, controller.signal);
    } catch (reason: unknown) {
      // Keep an incomplete test adapter or a synchronous client failure inside the same safe
      // error boundary as an asynchronous network failure.
      if (isCurrent()) {
        setError(errorState(reason));
        setFulfilledKey(requestKey);
        setIsLoading(false);
      }
      return;
    }
    void Promise.resolve(basesPromise)
      .then((options) => {
        if (!isCurrent()) return;
        setItems(options);
        setFulfilledKey(requestKey);
      })
      .catch((reason: unknown) => {
        if (!isCurrent()) return;
        setError(errorState(reason));
        setFulfilledKey(requestKey);
      })
      .finally(() => {
        if (isCurrent()) setIsLoading(false);
      });

    return () => {
      ++requestIdRef.current;
      controller.abort();
    };
  }, [request, requestKey, requestCountry, retryToken]);

  const currentItems = fulfilledKey === requestKey ? items : [];
  // Categories are presentation filters, not a client-side eligibility list. Keep the values seen
  // in server responses so a search result does not make an already available category disappear.
  const categories = useMemo(
    () => [...new Set(items.map((item) => item.category).filter(Boolean))].sort(),
    [items],
  );
  const refetch = () => {
    setRetryToken((value) => value + 1);
    setFulfilledKey(null);
    setIsLoading(true);
    setError(null);
  };

  return (
    <section
      aria-labelledby="custom-blend-base-picker-heading"
      className="custom-blend-surface grid gap-4 rounded-xl p-5"
    >
      <div>
        <p className="text-sm font-medium text-muted-foreground">
          {translate(customBlendMessages, 'customBlend.baseStep')}
        </p>
        <h2 id="custom-blend-base-picker-heading" className="text-xl font-semibold">
          {translate(customBlendMessages, 'customBlend.baseMaterial')}
        </h2>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="grid gap-1 text-sm">
          {translate(customBlendMessages, 'customBlend.searchMaterials')}
          <input
            type="search"
            id="custom-blend-search"
            className="rounded-md border px-3 py-1.5 text-sm"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          {translate(customBlendMessages, 'customBlend.category')}
          <select
            id="custom-blend-category"
            className="rounded-md border px-3 py-1.5 text-sm"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="">{translate(customBlendMessages, 'customBlend.allCategories')}</option>
            {categories.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && !suppressError ? (
        <div role="alert" aria-live="assertive" className="grid gap-3 py-6">
          <p className="text-destructive">{baseErrorMessage(error, translate)}</p>
          <Button type="button" variant="outline" size="sm" onClick={refetch}>
            {translate(commonMessages, 'common.retry')}
          </Button>
        </div>
      ) : isLoading ? (
        <div
          role="status"
          aria-live="polite"
          aria-busy="true"
          aria-label={translate(customBlendMessages, 'customBlend.loadingMaterials')}
          className="grid gap-3"
        >
          <div className="h-12 animate-pulse rounded-xl bg-muted" />
          <div className="h-12 animate-pulse rounded-xl bg-muted" />
        </div>
      ) : currentItems.length === 0 ? (
        <p role="status" aria-live="polite">
          {translate(customBlendMessages, 'customBlend.noMaterials')}
        </p>
      ) : (
        <ul
          className="grid gap-3 sm:grid-cols-2"
          aria-label={translate(customBlendMessages, 'customBlend.baseOptions')}
        >
          {currentItems.map((base) => (
            <li
              key={base.variant.variantId}
              className="custom-blend-tile grid grid-cols-[4.5rem_1fr] gap-3 rounded-xl p-3"
            >
              {resolveCatalogPackagingPalette({
                id: base.productId,
                category: base.category,
              }) ? (
                <PackagingArtwork
                  name={base.productName}
                  spec={resolvePackagingSpec({
                    product: optionPackagingProduct(base),
                    variant: base.variant,
                  })}
                  mark="CB"
                  consumptionLabel={base.consumptionClassification}
                  ariaLabel={`${base.productName} ${translate(customBlendMessages, 'customBlend.packaging')}`}
                  className="h-[4.5rem] w-[4.5rem]"
                />
              ) : (
                <div
                  aria-label={`${base.productName} ${translate(customBlendMessages, 'customBlend.packagingUnavailableAria')}`}
                  className="grid h-[4.5rem] w-[4.5rem] place-items-center rounded border bg-muted px-1 text-center text-[10px] text-muted-foreground"
                >
                  {translate(customBlendMessages, 'customBlend.packagingUnavailable')}
                </div>
              )}
              <div className="grid content-start gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{base.productName}</span>
                  <Badge variant="secondary">{base.category}</Badge>
                </div>
                {base.mixingGroup && (
                  <span className="text-xs text-muted-foreground">
                    {translate(customBlendMessages, 'customBlend.mixingGroup', {
                      group: base.mixingGroup,
                    })}
                  </span>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="justify-self-start"
                  onClick={() => onSelectBase(base.variant.variantId)}
                >
                  {translate(customBlendMessages, 'customBlend.useAsBase', {
                    name: base.productName,
                  })}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
