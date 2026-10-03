import { useLocation, useSearchParams, Link } from 'react-router-dom';
import { useCategories } from '@/hooks/useCategories';
import { cn } from '@/lib/utils';
import { customBlendItem } from './nav/navItems';
import { useLocalisation } from '@/i18n/LocaleContext';
import { webMessages } from '@shop/localisation/messages/webShell';

/**
 * Functional category filter navigation.
 * Fetches categories from the API and drives catalog
 * filtering via the `?category=` URL search parameter.
 */
export function CategoryNav() {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const isCatalog = pathname === '/catalog';
  const activeCategory = searchParams.get('category') ?? '';
  const isDealsActive = isCatalog && searchParams.get('onSale') === 'true';
  const { categories, isLoading } = useCategories();
  const { translate } = useLocalisation();

  const linkClassName = (isActive: boolean) =>
    cn(
      'rounded-md px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm',
      isActive && 'bg-accent font-semibold text-accent-foreground',
    );

  return (
    <nav
      aria-label={translate(webMessages, 'shell.productCategories')}
      className="flex min-w-max items-center gap-0.5"
    >
      <Link
        to="/catalog"
        aria-current={isCatalog && activeCategory === '' && !isDealsActive ? 'page' : undefined}
        className={linkClassName(isCatalog && activeCategory === '' && !isDealsActive)}
      >
        {translate(webMessages, 'shell.allMaterials')}
      </Link>
      {!isLoading &&
        categories.slice(0, 6).map((category) => (
          <Link
            key={category}
            to={`/catalog?category=${encodeURIComponent(category)}`}
            aria-current={
              isCatalog && activeCategory === category && !isDealsActive ? 'page' : undefined
            }
            className={linkClassName(isCatalog && activeCategory === category && !isDealsActive)}
          >
            {category}
          </Link>
        ))}
      <Link
        to="/bundles"
        aria-current={pathname === '/bundles' ? 'page' : undefined}
        className={linkClassName(pathname === '/bundles')}
      >
        {translate(webMessages, 'shell.bundles')}
      </Link>
      <Link
        to="/custom-blend"
        aria-current={pathname === '/custom-blend' ? 'page' : undefined}
        className={cn(
          'rounded-md px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm',
          customBlendItem.className,
        )}
      >
        {translate(webMessages, 'shell.customBlend')}
      </Link>
      <Link
        to="/catalog?onSale=true&sort=bestselling"
        aria-current={isDealsActive ? 'page' : undefined}
        className={cn(
          'rounded-md px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap text-sale transition-colors hover:bg-sale/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm',
          isDealsActive && 'bg-sale/10',
        )}
      >
        {translate(webMessages, 'shell.stockOffers')}
      </Link>
    </nav>
  );
}
