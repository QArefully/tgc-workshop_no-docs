import type { Migration } from '../migrate.js';
import { initialMigration } from './001_initial.js';
import { catalogColumnsMigration } from './002_catalog_columns.js';
import { promoColumnsMigration } from './003_promo_columns.js';
import { orderUserMigration } from './004_order_user.js';
import { paymentReplayResponseMigration } from './005_payment_replay_response.js';
import { passwordResetTokenDigestMigration } from './006_password_reset_token_digest.js';
import { checkoutIntentsMigration } from './007_checkout_intents.js';
import { powderizerMigration } from './008_powderizer.js';
import { powderizerExpansionMigration } from './009_powderizer_expansion.js';
import { catalogMetadataMigration } from './010_catalog_metadata.js';
import { auditEventsMigration } from './011_audit_events.js';
import { curatedBundlesMigration } from './012_curated_bundles.js';
import { customerReviewsMigration } from './013_customer_reviews.js';
import { orderLifecycleMigration } from './014_order_lifecycle.js';
import { inventoryMigration } from './015_inventory.js';
import { reviewDepthMigration } from './016_review_depth.js';
import { returnsRefundsMigration } from './017_returns_refunds.js';
import { groundedCatalogVariantsMigration } from './018_grounded_catalog_variants.js';
import { variantMoqMigration } from './019_variant_moq.js';
import { retireLegacyVariantsMigration } from './020_retire_legacy_variants.js';
import { removePowderizerMigration } from './021_remove_powderizer.js';
import { customBlendsMigration } from './022_custom_blends.js';
import { tradeDeliveryAndCheckoutDepthMigration } from './023_trade_delivery_and_checkout_depth.js';
import { pricingPromotionsMigration } from './024_pricing_promotions.js';
import { accountSelfServiceMigration } from './025_account_self_service.js';
import { companyAccountsApprovalsMigration } from './026_company_accounts_approvals.js';
import { adminSurfaceMigration } from './027_admin_surface.js';
import { retiredVariantSortOrderMigration } from './028_retired_variant_sort_order.js';
import { savedListsMigration } from './029_saved_lists.js';
import { asyncBehaviorMigration } from './030_async_behavior.js';
import { backInStockMigration } from './031_back_in_stock.js';
import { countryLocalisationMigration } from './032_country_localisation.js';
import { promoCountryTargetingMigration } from './033_promo_country_targeting.js';
import { mailboxOrderReceiptMigration } from './034_mailbox_order_receipt.js';
import { tradeCreditAccountsAndIntentsMigration } from './035_trade_credit_accounts_and_intents.js';
import { creditInvoicesMigration } from './036_credit_invoices.js';
import { invoiceMailboxMigration } from './037_invoice_mailbox.js';
import { paymentUserIdentityMigration } from './038_payment_user_identity.js';

export const migrations: readonly Migration[] = [
  initialMigration,
  catalogColumnsMigration,
  promoColumnsMigration,
  orderUserMigration,
  paymentReplayResponseMigration,
  passwordResetTokenDigestMigration,
  checkoutIntentsMigration,
  powderizerMigration,
  powderizerExpansionMigration,
  catalogMetadataMigration,
  auditEventsMigration,
  curatedBundlesMigration,
  customerReviewsMigration,
  orderLifecycleMigration,
  inventoryMigration,
  reviewDepthMigration,
  returnsRefundsMigration,
  groundedCatalogVariantsMigration,
  variantMoqMigration,
  retireLegacyVariantsMigration,
  removePowderizerMigration,
  customBlendsMigration,
  tradeDeliveryAndCheckoutDepthMigration,
  pricingPromotionsMigration,
  accountSelfServiceMigration,
  companyAccountsApprovalsMigration,
  adminSurfaceMigration,
  retiredVariantSortOrderMigration,
  savedListsMigration,
  asyncBehaviorMigration,
  backInStockMigration,
  countryLocalisationMigration,
  promoCountryTargetingMigration,
  mailboxOrderReceiptMigration,
  tradeCreditAccountsAndIntentsMigration,
  creditInvoicesMigration,
  invoiceMailboxMigration,
  paymentUserIdentityMigration,
];
