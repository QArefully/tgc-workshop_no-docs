import { ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';

import { PackagingArtwork } from '@/components/packaging/PackagingArtwork';
import { NEUTRAL_PACKAGING_SCHEME, type PackagingSpec } from '@/components/packaging/packagingSpec';
import { INKS, titleLines } from '@/components/packaging/svgText';
import { Button } from '@/components/ui/button';
import { useLocalisation } from '@/i18n/LocaleContext';
import { webMessages } from '@shop/localisation/messages/webShell';
import { commonMessages } from '@shop/localisation/messages/common';

interface TileArtwork {
  name: string;
  spec: PackagingSpec;
  mark: string;
  accent?: string;
  powderAccent?: string;
  consumptionLabel: string | null;
}

const BRAND = 'QAREFULLY MATERIALS EXCHANGE';

const foodSpec = (name: string, sub: string, lot: string, netWeight: string): PackagingSpec => ({
  vessel: 'food-bag',
  // Hand-authored marketing tiles are not canonical catalog products, so they carry the neutral
  // scheme rather than a category palette entry.
  ...NEUTRAL_PACKAGING_SCHEME,
  ink: { ink: '#242522', alert: '#b0381a' },
  brand: BRAND,
  titleLines: titleLines(name),
  sub,
  lot,
  netWeight,
});

const tileArtwork: Readonly<Record<string, TileArtwork>> = {
  'sports nutrition': {
    name: 'Protein Blend',
    spec: foodSpec('Protein Blend', 'Sports Nutrition', 'SN-01', '25 kg'),
    mark: 'PRO',
    accent: '#78956c',
    powderAccent: '#d5dfbc',
    consumptionLabel: null,
  },
  'baking & pantry': {
    name: 'Baking Sugar',
    spec: foodSpec('Baking Sugar', 'Baking & Pantry', 'BP-01', '25 kg'),
    mark: 'SUG',
    accent: '#e1a156',
    powderAccent: '#f2d8a6',
    consumptionLabel: null,
  },
  drinks: {
    name: 'Matcha Blend',
    spec: foodSpec('Matcha Blend', 'Drinks', 'DRK-03', '25 kg'),
    mark: 'MTC',
    accent: '#849b58',
    powderAccent: '#c7d486',
    consumptionLabel: null,
  },
  'household & cleaning': {
    name: 'Laundry Detergent',
    spec: {
      vessel: 'keg',
      tone: 'corrosive',
      ...NEUTRAL_PACKAGING_SCHEME,
      ink: INKS.clean,
      brand: BRAND,
      titleLines: titleLines('Laundry Detergent'),
      sub: 'Household & Cleaning',
      lot: 'HCL-0020',
      netWeight: '1,000 kg',
      grade: 'One scoop (60 g) per standard load',
      hazard: 'Causes serious eye irritation',
    },
    mark: 'LND',
    accent: '#6c9cb3',
    powderAccent: '#c8e0eb',
    consumptionLabel: null,
  },
  'garden & outdoors': {
    name: 'Garden Lime',
    spec: {
      vessel: 'woven-sack',
      ...NEUTRAL_PACKAGING_SCHEME,
      ink: INKS.garden,
      brand: BRAND,
      titleLines: titleLines('Garden Lime'),
      sub: 'Garden & Outdoors',
      lot: 'GDN-0030',
      netWeight: '1,000 kg',
      grade: '0-0-0 (Calcium carbonate 90%+)',
      hazard: 'Causes eye irritation',
      yield: 'One 5 kg bag treats approximately 50 m2',
    },
    mark: 'LIM',
    accent: '#c3774e',
    powderAccent: '#e7b78f',
    consumptionLabel: null,
  },
  'trade & creative materials': {
    name: 'Portland Cement',
    spec: {
      vessel: 'kraft-sack',
      ...NEUTRAL_PACKAGING_SCHEME,
      ink: INKS.trade,
      brand: BRAND,
      titleLines: titleLines('Portland Cement'),
      sub: 'Trade & Creative Materials',
      lot: 'TCM-0033',
      netWeight: '1,000 kg',
      grade: 'CEM I 42.5N',
      hazard: 'Dust mask, gloves, eye protection',
    },
    mark: 'CEM',
    accent: '#8c7ba8',
    powderAccent: '#d0c3df',
    consumptionLabel: null,
  },
};

interface CategoryTilesProps {
  categories: string[];
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
}

export function CategoryTiles({ categories, isLoading, error, onRetry }: CategoryTilesProps) {
  const { translate } = useLocalisation();
  const t = (key: keyof typeof webMessages) => translate(webMessages, key);
  return (
    <section aria-labelledby="category-heading">
      <p className="section-eyebrow">{t('home.chooseMaterial')}</p>
      <h2 id="category-heading" className="section-heading mt-2">
        {t('home.shopByCategory')}
      </h2>
      {error ? (
        <div role="status" className="mt-6 rounded-2xl border bg-surface-raised p-5 text-sm">
          <p className="text-muted-foreground">{t('home.categoriesUnavailable')}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
            {translate(commonMessages, 'common.retry')}
          </Button>
        </div>
      ) : isLoading ? (
        <div
          aria-label={t('home.loadingCategories')}
          className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="aspect-[4/3] animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : categories.length === 0 ? null : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {categories.slice(0, 6).map((category) => {
            const artwork = tileArtwork[category.toLowerCase()];
            return (
              <Link
                key={category}
                to={`/catalog?category=${encodeURIComponent(category)}`}
                className="group relative aspect-[4/3] overflow-hidden rounded-xl border border-foreground/20 bg-surface-soft shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {artwork ? (
                  <PackagingArtwork
                    name={artwork.name}
                    spec={artwork.spec}
                    mark={artwork.mark}
                    accent={artwork.accent}
                    powderAccent={artwork.powderAccent}
                    consumptionLabel={artwork.consumptionLabel}
                    ariaLabel=""
                    className="h-full w-full object-cover p-3 transition-transform duration-200 group-hover:scale-105"
                  />
                ) : (
                  <div
                    aria-hidden="true"
                    className="h-full w-full bg-[radial-gradient(circle_at_25%_20%,rgba(255,255,255,0.85),transparent_32%),linear-gradient(135deg,oklch(0.91_0.03_240),oklch(0.78_0.07_250))]"
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-foreground/85 via-foreground/10 to-transparent" />
                <span className="absolute inset-x-0 bottom-0 flex items-center justify-between p-5 text-lg font-semibold text-white">
                  {category}
                  <ArrowUpRight className="size-5" />
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
