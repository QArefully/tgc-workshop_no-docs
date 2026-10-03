import { BagArtwork } from '@/components/BagArtwork';
import { ProductGrid } from '@/components/ProductGrid';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { productMessages } from '@shop/localisation/messages/product';
import { useLocalisation } from '@/i18n/LocaleContext';

const designs: ReadonlyArray<{
  option: string;
  title: string;
  note: string;
}> = [
  {
    option: 'C2-D',
    title: 'Paired ovals',
    note: 'The cleanest treatment: two overlapping material forms and very few dots.',
  },
];

const artworkProps = {
  name: 'Protein Powder',
  category: 'Sports Nutrition',
  quantity: '1kg',
  batchCode: 'SN-01',
  mark: 'PRO',
  accent: '#78956c',
  powderAccent: '#d5dfbc',
  consumptionLabel: null,
} as const;

export function BagDesignsPage() {
  const { translate, formatDisplayMoney } = useLocalisation();
  const t = <K extends keyof typeof productMessages>(
    key: K,
    params?: Record<string, string | number>,
  ) => translate(productMessages, key, params);
  return (
    <div className="space-y-8 pb-12">
      <header className="max-w-3xl space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          {t('product.packagingStudy')}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {t('product.lockedDesign', { option: 'C2-D' })}
        </h1>
        <p className="text-muted-foreground">{t('product.designDescription')}</p>
      </header>

      <ProductGrid className="items-start">
        {designs.map((design) => (
          <article key={design.option} className="min-w-0 space-y-3">
            <div className="flex items-start gap-3">
              <span className="flex h-8 min-w-8 shrink-0 items-center justify-center rounded-full bg-foreground px-1.5 text-xs font-black text-background">
                {design.option}
              </span>
              <div>
                <h2 className="font-semibold">{t('product.designTitle')}</h2>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t('product.designNote')}
                </p>
              </div>
            </div>

            <Card className="group flex h-full flex-col gap-0 overflow-hidden border-border/80 bg-surface-raised py-0 shadow-sm">
              <div className="relative aspect-4/5 overflow-hidden bg-surface-soft">
                <BagArtwork {...artworkProps} className="h-full w-full object-contain p-4 sm:p-5" />
                <div className="pointer-events-none absolute top-3 left-3 flex flex-wrap gap-1.5">
                  <Badge
                    variant="secondary"
                    className="border-primary/10 bg-background/95 px-2.5 text-primary shadow-sm"
                  >
                    {t('product.bestseller')}
                  </Badge>
                </div>
              </div>
              <CardContent className="flex flex-1 flex-col gap-2 p-4 pt-4 sm:p-5 sm:pt-4">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Sports Nutrition
                </p>
                <h3 className="min-h-11 text-base font-semibold leading-[1.35] tracking-tight">
                  Protein Powder
                </h3>
                <p className="text-xs text-muted-foreground">
                  {t('product.pack', { quantity: '1kg' })}
                </p>
                <div className="mt-auto pt-2">
                  <span className="price-current">{formatDisplayMoney(3495)}</span>
                </div>
              </CardContent>
              <CardFooter className="border-t-0 bg-transparent p-4 pt-0 sm:px-5 sm:pb-5">
                <Button className="w-full">{t('product.addToCart')}</Button>
              </CardFooter>
            </Card>
          </article>
        ))}
      </ProductGrid>

      <aside className="rounded-2xl border bg-surface-raised p-5 text-sm text-muted-foreground">
        {t('product.designAside')}
      </aside>
    </div>
  );
}
