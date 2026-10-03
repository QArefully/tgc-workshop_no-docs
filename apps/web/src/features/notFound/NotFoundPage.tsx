import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useLocalisation } from '@/i18n/LocaleContext';
import { webMessages } from '@shop/localisation/messages/webShell';

/** 404 page shown for unknown routes. */
export function NotFoundPage() {
  const { translate } = useLocalisation();
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
      <h1 className="text-6xl font-extrabold text-muted-foreground/30">404</h1>
      <h2 className="text-xl font-semibold">{translate(webMessages, 'notFound.title')}</h2>
      <p className="text-muted-foreground">{translate(webMessages, 'notFound.description')}</p>
      <Button nativeButton={false} render={(props) => <Link to="/" {...props} />}>
        {translate(webMessages, 'notFound.backHome')}
      </Button>
    </div>
  );
}
