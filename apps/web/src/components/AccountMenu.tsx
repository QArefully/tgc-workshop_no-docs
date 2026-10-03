import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/AuthContext';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { LogIn, User } from 'lucide-react';
import { useLocalisation } from '@/i18n/LocaleContext';
import { webMessages } from '@shop/localisation/messages/webShell';

/**
 * Account menu in the header.
 * Shows Sign In link when anonymous, user menu when authenticated.
 */
export function AccountMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { translate } = useLocalisation();
  const t = (key: keyof typeof webMessages) => translate(webMessages, key);

  async function handleLogout() {
    await logout();
    navigate('/', { replace: true });
  }

  // Anonymous state
  if (!user) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="sm" />}
          aria-label={t('shell.account')}
        >
          <User />
          {t('shell.account')}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => navigate('/login')}>
            <LogIn className="mr-2 h-4 w-4" />
            {t('shell.signIn')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // Authenticated state
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="sm" />}
        aria-label={t('shell.account')}
      >
        <User />
        {user.displayName}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <div className="px-2 py-1.5 text-xs text-muted-foreground">{user.email}</div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate('/account')}>
          {t('shell.myAccount')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate('/orders')}>
          {t('shell.myOrders')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate('/lists')}>{t('shell.myLists')}</DropdownMenuItem>
        {user.role === 'admin' && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/admin/reviews')}>
              {t('shell.reviewModeration')}
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void handleLogout()}>
          {t('shell.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
