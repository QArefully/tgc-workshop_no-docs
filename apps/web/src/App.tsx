import { Navigate, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { HomePage } from './features/home/HomePage';
import { CatalogPage } from './features/catalog/CatalogPage';
import { ProductPage } from './features/product/ProductPage';
import { CartPage } from './features/cart/CartPage';
import { CheckoutPage } from './features/checkout/CheckoutPage';
import { OrderConfirmationPage } from './features/checkout/OrderConfirmationPage';
import { LoginPage } from './features/auth/LoginPage';
import { SignupPage } from './features/auth/SignupPage';
import { ForgotPasswordPage } from './features/auth/ForgotPasswordPage';
import { ResetPasswordPage } from './features/auth/ResetPasswordPage';
import { AccountPage } from './features/account/AccountPage';
import { MailboxPage } from './features/mailbox/MailboxPage';
import { NotFoundPage } from './features/notFound/NotFoundPage';
import { BagDesignsPage } from './features/designs/BagDesignsPage';
import { HelpIndexPage } from './features/help/HelpIndexPage';
import { HelpArticlePage } from './features/help/HelpArticlePage';
import { ComparisonPage } from './features/comparison/ComparisonPage';
import { BundlesPage } from './features/bundles/BundlesPage';
import { CustomBlendPage } from './features/customBlend/CustomBlendPage';
import { OrderHistoryPage } from './features/orders/OrderHistoryPage';
import { OrderDetailPage } from './features/orders/OrderDetailPage';
import { AdminRoute } from './components/AdminRoute';
import { AdminLayout } from './features/admin/AdminLayout';
import { AdminIndexPage } from './features/admin/AdminIndexPage';
import { AdminReviewModerationPage } from './features/admin/reviews';
import { CompanyPage } from './features/company/CompanyPage';
import { AcceptInvitePage } from './features/company/AcceptInvitePage';
import { ApprovalsPage } from './features/approvals/ApprovalsPage';
import { AdminProductsPage } from './features/admin/products/AdminProductsPage';
import { AdminVariantsPage } from './features/admin/lots/AdminVariantsPage';
import { AdminPromosPage } from './features/admin/promos/AdminPromosPage';
import { AdminUsersPage } from './features/admin/users';
import { AdminOrdersPage } from './features/admin/orders';
import { AdminFeatureFlagsPage } from './features/admin/featureFlags';
import { QuickOrderPage } from './features/quickOrder/QuickOrderPage';
import { SavedListsPage } from './features/savedLists/SavedListsPage';
import { SavedListDetailPage } from './features/savedLists/SavedListDetailPage';
import { NotificationsPage } from './features/notifications/NotificationsPage';
import { StandingOrdersPage } from './features/standingOrders/StandingOrdersPage';
import { AdminJobsPage, AdminJobDetailPage } from './features/admin/jobs';
import { AdminWebhooksPage, AdminWebhookDetailPage } from './features/admin/webhooks';
import {
  AdminCreditAccountsPage,
  AdminCreditAccountDetailPage,
  AdminInvoicesPage,
  AdminInvoiceDetailPage,
} from './features/admin/credit';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/catalog" element={<CatalogPage />} />
        <Route path="/compare" element={<ComparisonPage />} />
        <Route path="/bundles" element={<BundlesPage />} />
        <Route path="/custom-blend" element={<CustomBlendPage />} />
        <Route path="/products/:id" element={<ProductPage />} />
        <Route path="/cart" element={<CartPage />} />
        <Route path="/quick-order" element={<QuickOrderPage />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/order-confirmation/:orderId" element={<OrderConfirmationPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route
          path="/account"
          element={
            <ProtectedRoute>
              <AccountPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/account/company"
          element={
            <ProtectedRoute>
              <CompanyPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/account/approvals"
          element={
            <ProtectedRoute>
              <ApprovalsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/account/standing-orders"
          element={
            <ProtectedRoute>
              <StandingOrdersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/notifications"
          element={
            <ProtectedRoute>
              <NotificationsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/invites/accept"
          element={
            <ProtectedRoute>
              <AcceptInvitePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/wishlist"
          element={
            <ProtectedRoute>
              <Navigate to="/lists" replace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists"
          element={
            <ProtectedRoute>
              <SavedListsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/:listId"
          element={
            <ProtectedRoute>
              <SavedListDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/orders"
          element={
            <ProtectedRoute>
              <OrderHistoryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/orders/:orderId"
          element={
            <ProtectedRoute>
              <OrderDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <AdminRoute>
              <AdminLayout />
            </AdminRoute>
          }
        >
          <Route index element={<AdminIndexPage />} />
          <Route path="products" element={<AdminProductsPage />} />
          <Route path="variants" element={<AdminVariantsPage />} />
          <Route path="promos" element={<AdminPromosPage />} />
          <Route path="users" element={<AdminUsersPage />} />
          <Route path="orders" element={<AdminOrdersPage />} />
          <Route path="credit-accounts" element={<AdminCreditAccountsPage />} />
          <Route
            path="credit-accounts/:creditAccountId"
            element={<AdminCreditAccountDetailPage />}
          />
          <Route path="invoices" element={<AdminInvoicesPage />} />
          <Route path="invoices/:invoiceId" element={<AdminInvoiceDetailPage />} />
          <Route path="jobs" element={<AdminJobsPage />} />
          <Route path="jobs/:jobId" element={<AdminJobDetailPage />} />
          <Route path="webhooks" element={<AdminWebhooksPage />} />
          <Route path="webhooks/:webhookId" element={<AdminWebhookDetailPage />} />
          <Route path="feature-flags" element={<AdminFeatureFlagsPage />} />
          <Route path="reviews" element={<AdminReviewModerationPage />} />
        </Route>
        <Route path="/mailbox" element={<MailboxPage />} />
        <Route path="/bag-designs" element={<BagDesignsPage />} />
        <Route path="/help" element={<HelpIndexPage />} />
        <Route path="/help/:slug" element={<HelpArticlePage group="help" />} />
        <Route path="/policies/:slug" element={<HelpArticlePage group="policy" />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
