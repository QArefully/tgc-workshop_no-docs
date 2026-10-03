import { Link } from 'react-router-dom';
import type { Product, ProductSpecification, PriceRange } from '@shop/contracts/products';
import { ProductMedia } from '@/components/ProductMedia';
import { useLocalisation } from '@/i18n/LocaleContext';
import { discoveryMessages } from '@shop/localisation/messages/discovery';

interface MatrixProduct extends Product {
  priceRange?: PriceRange;
  baseAvailability?: 'in_stock' | 'low_stock' | 'out_of_stock' | 'backorder';
  variants?: unknown[];
}

interface ComparisonMatrixProps {
  products: readonly MatrixProduct[];
  onRemove: (productId: string) => void;
}

interface MatrixRow {
  key: string;
  groupLabel: string;
  groupOrder: number;
  specificationLabel: string;
  specificationPosition: number;
  values: readonly (ProductSpecification | undefined)[];
  differs: boolean;
}

const MISSING_VALUE = '__not_specified__';

function buildRows(products: readonly MatrixProduct[]): MatrixRow[] {
  const rows = new Map<
    string,
    Omit<MatrixRow, 'values' | 'differs'> & { values: (ProductSpecification | undefined)[] }
  >();

  products.forEach((product, productIndex) => {
    product.specificationGroups.forEach((group) => {
      group.specifications.forEach((specification, specificationPosition) => {
        const rowKey = `${group.key}:${specification.key}`;
        const existing = rows.get(rowKey);
        if (existing) {
          existing.values[productIndex] = specification;
          return;
        }
        const values = Array<ProductSpecification | undefined>(products.length).fill(undefined);
        values[productIndex] = specification;
        rows.set(rowKey, {
          key: rowKey,
          groupLabel: group.label,
          groupOrder: group.order,
          specificationLabel: specification.label,
          specificationPosition,
          values,
        });
      });
    });
  });

  return [...rows.values()]
    .map((row) => ({
      ...row,
      differs: new Set(row.values.map((value) => value?.valueKey ?? MISSING_VALUE)).size > 1,
    }))
    .sort(
      (left, right) =>
        Number(right.differs) - Number(left.differs) ||
        left.groupOrder - right.groupOrder ||
        left.specificationPosition - right.specificationPosition ||
        left.key.localeCompare(right.key),
    );
}

export function ComparisonMatrix({ products, onRemove }: ComparisonMatrixProps) {
  const { translate, formatDisplayMoney } = useLocalisation();
  const t = (key: keyof typeof discoveryMessages, params?: Record<string, string | number>) =>
    translate(discoveryMessages, key, params);
  const priceLabel = (product: MatrixProduct) => {
    const range = product.priceRange;
    if (range && range.min !== range.max)
      return t('product.from', { price: formatDisplayMoney(range.min) });
    return formatDisplayMoney(range?.min ?? product.priceCents);
  };
  const availabilityLabel = (product: MatrixProduct) => {
    const base = product.baseAvailability;
    if (base === 'in_stock' || base === 'low_stock') return t('comparison.available');
    if (base === 'backorder') return t('comparison.backorder');
    if (base === 'out_of_stock') return t('comparison.outOfStock');
    return product.available ? t('comparison.available') : t('comparison.outOfStock');
  };
  const rows = buildRows(products);

  return (
    <div className="overflow-x-auto rounded-2xl border bg-surface-raised focus-within:ring-2 focus-within:ring-ring">
      <table className="min-w-full border-collapse text-left text-sm">
        <caption className="p-5 text-left text-base font-semibold">
          {t('comparison.tableCaption')}
        </caption>
        <thead className="border-y bg-surface-soft align-top">
          <tr>
            <th scope="col" className="min-w-44 p-4 font-semibold">
              {t('comparison.specification')}
            </th>
            {products.map((product) => (
              <th key={product.id} scope="col" className="min-w-56 p-4 font-normal">
                <div className="space-y-3">
                  <ProductMedia
                    product={product}
                    className="h-36 w-full rounded-lg object-contain"
                  />
                  <Link
                    to={`/products/${product.id}`}
                    className="block rounded-sm font-semibold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {product.name}
                  </Link>
                  <dl className="space-y-1 text-xs text-muted-foreground">
                    <div>
                      <dt className="sr-only">{t('comparison.price')}</dt>
                      <dd>{priceLabel(product)}</dd>
                    </div>
                    <div>
                      <dt className="sr-only">{t('comparison.category')}</dt>
                      <dd>{product.category}</dd>
                    </div>
                    <div>
                      <dt className="sr-only">{t('comparison.availability')}</dt>
                      <dd>{availabilityLabel(product)}</dd>
                    </div>
                    {product.consumptionClassification && (
                      <div>
                        <dt className="sr-only">{t('comparison.classification')}</dt>
                        <dd>{product.consumptionClassification}</dd>
                      </div>
                    )}
                  </dl>
                  <button
                    type="button"
                    onClick={() => onRemove(product.id)}
                    className="rounded-sm text-xs font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t('comparison.remove', { name: product.name })}
                  </button>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className={row.differs ? 'bg-primary/5' : 'border-t'}>
              <th scope="row" className="border-t p-4 font-medium">
                <span className="block text-xs font-normal text-muted-foreground">
                  {row.groupLabel}
                </span>
                {row.specificationLabel}
              </th>
              {row.values.map((value, index) => (
                <td
                  key={`${row.key}:${products[index]!.id}`}
                  className="border-t p-4 text-muted-foreground"
                >
                  {value?.value ?? t('comparison.notSpecified')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
