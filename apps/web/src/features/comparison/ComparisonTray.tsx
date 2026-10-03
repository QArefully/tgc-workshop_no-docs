import { Link } from 'react-router-dom';
import { Button, buttonVariants } from '@/components/ui/button';
import { useComparisonSelection } from './ComparisonSelectionContext';
import { useLocalisation } from '@/i18n/LocaleContext';
import { discoveryMessages } from '@shop/localisation/messages/discovery';

export function ComparisonTray() {
  const { translate, formatCount } = useLocalisation();
  const { selectedIds, clear, canCompare, comparePath, capacityStatus } = useComparisonSelection();
  const count = selectedIds.length;

  return (
    <aside
      aria-label={translate(discoveryMessages, 'comparison.trayLabel')}
      className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-surface-soft px-4 py-3"
    >
      <p className="text-sm font-medium">
        {translate(discoveryMessages, 'comparison.selected', {
          count,
          displayCount: formatCount(count),
        })}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {canCompare && comparePath ? (
          <Link to={comparePath} className={buttonVariants({ size: 'sm' })}>
            {translate(discoveryMessages, 'comparison.compareSelected')}
          </Link>
        ) : (
          <Button size="sm" disabled>
            {translate(discoveryMessages, 'comparison.compareSelected')}
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={count === 0} onClick={clear}>
          {translate(discoveryMessages, 'comparison.clearSelection')}
        </Button>
      </div>
      <p role="status" aria-live="polite" className="w-full text-sm text-muted-foreground">
        {capacityStatus === 'at-capacity'
          ? translate(discoveryMessages, 'comparison.capacity')
          : ''}
      </p>
    </aside>
  );
}
