import { Button } from '@/components/ui/button';
import { useComparisonSelection } from './ComparisonSelectionContext';
import { useLocalisation } from '@/i18n/LocaleContext';
import { discoveryMessages } from '@shop/localisation/messages/discovery';

interface CompareProductButtonProps {
  productId: string;
  productName?: string;
}

export function CompareProductButton({ productId, productName }: CompareProductButtonProps) {
  const { translate } = useLocalisation();
  const { isSelected, toggle } = useComparisonSelection();
  const selected = isSelected(productId);
  const label = productName
    ? translate(discoveryMessages, 'product.compareNamed', { name: productName })
    : translate(discoveryMessages, 'product.compareProduct');

  return (
    <Button
      type="button"
      variant="outline"
      aria-pressed={selected}
      aria-label={label}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        toggle(productId);
      }}
    >
      {selected
        ? translate(discoveryMessages, 'product.selectedForComparison')
        : translate(discoveryMessages, 'product.compare')}
    </Button>
  );
}
