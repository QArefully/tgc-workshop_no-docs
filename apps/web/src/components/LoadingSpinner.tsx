import { useLocalisation } from '@/i18n/LocaleContext';
import { commonMessages } from '@shop/localisation/messages/common';

export function LoadingSpinner() {
  const { translate } = useLocalisation();
  return (
    <div
      className="flex items-center justify-center py-12"
      role="status"
      aria-label={translate(commonMessages, 'common.loading')}
    >
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}
