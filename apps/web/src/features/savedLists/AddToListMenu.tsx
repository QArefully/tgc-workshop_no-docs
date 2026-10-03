import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/AuthContext';
import { useLocalisation } from '@/i18n/LocaleContext';
import { repeatBuyingMessages } from '@shop/localisation/messages/repeatBuying';
import { SavedListPicker } from './SavedListPicker';

export function AddToListMenu({
  variantId,
  quantity = 1,
}: {
  variantId?: number | null;
  quantity?: number;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { translate } = useLocalisation();
  const [open, setOpen] = useState(false);
  const onOpen = () => {
    if (!user) {
      navigate('/login', { state: { from: `${location.pathname}${location.search}` } });
      return;
    }
    setOpen(true);
  };
  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" disabled={variantId == null} onClick={onOpen}>
        {translate(repeatBuyingMessages, 'repeatBuying.saveToList')}
      </Button>
      {open && variantId != null && (
        <SavedListPicker variantId={variantId} quantity={quantity} onSaved={() => setOpen(false)} />
      )}
    </div>
  );
}
