import { Button } from '@/components/ui/button';
import { useLocalisation } from '@/i18n/LocaleContext';
import { commonMessages } from '@shop/localisation/messages/common';

interface ErrorMessageProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorMessage({ message, onRetry }: ErrorMessageProps) {
  const { translate } = useLocalisation();
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
      <p className="text-destructive">{message}</p>
      {onRetry && (
        <Button variant="default" size="sm" onClick={onRetry}>
          {translate(commonMessages, 'common.retry')}
        </Button>
      )}
    </div>
  );
}
