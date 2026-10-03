import { Outlet } from 'react-router-dom';
import { CartProvider } from '@/hooks/CartContext';
import { SavedListsProvider } from '@/hooks/SavedListsContext';
import { AuthProvider } from '@/hooks/AuthContext';
import { CountryProvider } from '@/hooks/CountryContext';
import { NotificationsProvider } from '@/hooks/NotificationsContext';
import { BackInStockProvider } from '@/hooks/BackInStockContext';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ToastProvider } from '@/components/ToastProvider';
import { ComparisonSelectionProvider } from '@/features/comparison/ComparisonSelectionContext';
import { CountryBanner } from './CountryBanner';
import { Footer } from './Footer';
import { Header } from './Header';
import { LocaleProvider } from '@/i18n/LocaleContext';

export function Layout() {
  return (
    <AuthProvider>
      <CountryProvider>
        <LocaleProvider>
          <NotificationsProvider>
            <BackInStockProvider>
              <CartProvider>
                <SavedListsProvider>
                  <ComparisonSelectionProvider>
                    <TooltipProvider>
                      <ToastProvider>
                        <div className="flex min-h-screen flex-col bg-background">
                          <Header />
                          <CountryBanner />
                          <main className="content-shell flex-1 py-6 sm:py-8">
                            <Outlet />
                          </main>
                          <Footer />
                        </div>
                      </ToastProvider>
                    </TooltipProvider>
                  </ComparisonSelectionProvider>
                </SavedListsProvider>
              </CartProvider>
            </BackInStockProvider>
          </NotificationsProvider>
        </LocaleProvider>
      </CountryProvider>
    </AuthProvider>
  );
}
