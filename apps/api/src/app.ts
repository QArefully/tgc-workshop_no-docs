import Fastify, { type FastifyError } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import fastifyCookie from '@fastify/cookie';
import type Database from 'better-sqlite3';
import type { Country } from '@shop/contracts/country';
import { authPlugin } from './plugins/auth.js';
import { countryContextPlugin } from './plugins/countryContext.js';
import { sendPublicError } from './utils/errors.js';
import productsRoutes from './routes/products.js';
import cartRoutes from './routes/cart.js';
import promoRoutes from './routes/promo.js';
import ordersRoutes from './routes/orders.js';
import type { OwnedOrderInvoiceReader } from './routes/orders.js';
import authRoutes from './routes/auth.js';
import paymentRoutes from './routes/payments.js';
import tradeCreditRoutes from './routes/tradeCredit.js';
import adminCreditRoutes from './routes/adminCredit.js';
import mailboxRoutes from './routes/mailbox.js';
import bundleRoutes from './routes/bundles.js';
import reorderRoutes from './routes/reorder.js';
import { createAuthService, type AuthService, type Clock } from './features/auth/authService.js';
import { createSessionRepository } from './features/auth/sessionRepository.js';
import { createSessionService, type SessionService } from './features/auth/sessionService.js';
import { createUserRepository } from './features/auth/userRepository.js';
import { createProductRepository } from './features/catalog/productRepository.js';
import { createProductService, type ProductService } from './features/catalog/productService.js';
import { createCartRepository } from './features/cart/cartRepository.js';
import { createCartService, type CartService } from './features/cart/cartService.js';
import { createOrderRepository } from './features/orders/orderRepository.js';
import { createOrderService, type OrderService } from './features/orders/orderService.js';
import { createInvoiceRepository } from './features/invoices/invoiceRepository.js';
import { createInvoiceService, type InvoiceService } from './features/invoices/invoiceService.js';
import {
  createCreditAccountRepository,
  type CreditAccountRepository,
} from './features/tradeCredit/creditAccountRepository.js';
import {
  createCreditHoldRepository,
  type CreditHoldRepository,
} from './features/tradeCredit/creditHoldRepository.js';
import {
  createCreditAccountService,
  type CreditAccountService,
} from './features/tradeCredit/creditAccountService.js';
import {
  createOrderAccessService,
  type OrderAccessService,
  type OrderAccessTokenSource,
} from './features/orders/orderAccessService.js';
import {
  createCheckoutService,
  type CheckoutService,
} from './features/checkout/checkoutService.js';
import {
  createMailboxRepository,
  type MailboxRepository,
} from './features/mailbox/mailboxRepository.js';
import { createPasswordResetRepository } from './features/passwordReset/passwordResetRepository.js';
import {
  createPasswordResetService,
  type PasswordResetService,
  type ResetTokenSource,
} from './features/passwordReset/passwordResetService.js';
import { createPromoRepository } from './features/promos/promoRepository.js';
import { createPromoService, type PromoService } from './features/promos/promoService.js';
import { createPaymentRepository } from './features/payments/paymentRepository.js';
import {
  simulatedPaymentGateway,
  type PaymentGateway,
} from './features/payments/paymentGateway.js';
import { createUnitOfWork, type UnitOfWork } from './db/unitOfWork.js';
import { createAuditRepository } from './features/audit/auditRepository.js';
import {
  createAuditReadService,
  createAuditWriter,
  type AuditReadService,
} from './features/audit/auditService.js';
import auditRoutes from './routes/audit.js';
import { createBundleRepository } from './features/bundles/bundleRepository.js';
import { createBundleService, type BundleService } from './features/bundles/bundleService.js';
import reviewsRoutes from './routes/reviews.js';
import returnsRoutes from './routes/returns.js';
import adminReturnsRoutes from './routes/adminReturns.js';
import { createReviewRepository } from './features/reviews/reviewRepository.js';
import { createReviewService, type ReviewService } from './features/reviews/reviewService.js';
import adminOrdersRoutes from './routes/adminOrders.js';
import adminInventoryRoutes from './routes/adminInventory.js';
import { createInventoryRepository } from './features/inventory/inventoryRepository.js';
import {
  createInventoryService,
  type InventoryService,
} from './features/inventory/inventoryService.js';
import type { ReturnService } from './features/returns/returnService.js';
import { createReturnRepository } from './features/returns/returnRepository.js';
import { createReturnService } from './features/returns/returnService.js';
import { createRefundGateway } from './features/returns/refundGateway.js';
import { createCustomBlendRepository } from './features/customBlend/customBlendRepository.js';
import { createCustomBlendResolver } from './features/customBlend/customBlendResolver.js';
import {
  createCustomBlendService,
  type CustomBlendService,
} from './features/customBlend/customBlendService.js';
import customBlendRoutes from './routes/customBlends.js';
import tradeAccountRoutes from './routes/tradeAccount.js';
import deliverySlotRoutes from './routes/deliverySlots.js';
import adminProductsRoutes from './routes/adminProducts.js';
import adminVariantsRoutes from './routes/adminVariants.js';
import adminPromosRoutes from './routes/adminPromos.js';
import adminUsersRoutes from './routes/adminUsers.js';
import adminOrdersListRoutes from './routes/adminOrdersList.js';
import adminRefundsRoutes from './routes/adminRefunds.js';
import adminFeatureFlagsRoutes from './routes/adminFeatureFlags.js';
import { createDeliverySiteRepository } from './features/tradeAccount/deliverySiteRepository.js';
import {
  createDeliverySiteService,
  type DeliverySiteService,
} from './features/tradeAccount/deliverySiteService.js';
import { createBillingEntityRepository } from './features/tradeAccount/billingEntityRepository.js';
import {
  createBillingEntityService,
  type BillingEntityService,
} from './features/tradeAccount/billingEntityService.js';
import {
  createDeliverySlotService,
  type DeliverySlotService,
} from './features/delivery/deliverySlotService.js';
import accountSessionRoutes from './routes/accountSessions.js';
import accountPreferencesRoutes from './routes/accountPreferences.js';
import accountExportRoutes from './routes/accountExport.js';
import accountDeletionRoutes from './routes/accountDeletion.js';
import companyAccountRoutes from './routes/companyAccounts.js';
import orderApprovalRoutes from './routes/orderApprovals.js';
import { createPreferencesRepository } from './features/preferences/preferencesRepository.js';
import {
  createPreferencesService,
  type PreferencesService,
} from './features/preferences/preferencesService.js';
import {
  createDataExportService,
  type DataExportService,
} from './features/accountExport/dataExportService.js';
import { createAccountDeletionRepository } from './features/accountDeletion/deletionRepository.js';
import {
  createAccountDeletionService,
  type AccountDeletionService,
} from './features/accountDeletion/deletionService.js';
import { createCompanyRepository } from './features/companyAccounts/companyRepository.js';
import { createCompanyMembershipRepository } from './features/companyAccounts/companyMembershipRepository.js';
import { createCompanyInviteRepository } from './features/companyAccounts/companyInviteRepository.js';
import {
  createCompanyService,
  type CompanyService,
} from './features/companyAccounts/companyService.js';
import { createApprovalRepository } from './features/orderApprovals/approvalRepository.js';
import {
  createApprovalService,
  type ApprovalService,
} from './features/orderApprovals/approvalService.js';
import {
  createProductAdminService,
  type ProductAdminService,
} from './features/catalog/productAdminService.js';
import { createProductAdminRepository } from './features/catalog/productAdminRepository.js';
import {
  createVariantAdminService,
  type VariantAdminService,
} from './features/catalog/variantAdminService.js';
import { createVariantAdminRepository } from './features/catalog/variantAdminRepository.js';
import {
  createPromoAdminService,
  type PromoAdminService,
} from './features/promos/promoAdminService.js';
import { createPromoAdminRepository } from './features/promos/promoAdminRepository.js';
import { createUserAdminService, type UserAdminService } from './features/auth/userAdminService.js';
import { createUserAdminRepository } from './features/auth/userAdminRepository.js';
import {
  createOrderAdminService,
  type OrderAdminService,
} from './features/orders/orderAdminService.js';
import { createOrderAdminRepository } from './features/orders/orderAdminRepository.js';
import {
  createAdminRefundService,
  type AdminRefundService,
} from './features/payments/adminRefundService.js';
import {
  createFeatureFlagService,
  type FeatureFlagService,
} from './features/featureFlags/featureFlagService.js';
import { createFeatureFlagRepository } from './features/featureFlags/featureFlagRepository.js';
import { createFeatureFlagResolver } from './features/featureFlags/featureFlagResolver.js';
import type { FeatureFlagResolver } from './features/featureFlags/featureFlagResolver.js';
import {
  createCountryProfileService,
  type CountryProfileService,
} from './features/countryProfile/countryProfileService.js';
import { createReorderService, type ReorderService } from './features/reorder/reorderService.js';
import {
  createQuickOrderService,
  type QuickOrderService,
} from './features/quickOrder/quickOrderService.js';
import quickOrderRoutes from './routes/quickOrder.js';
import savedListRoutes from './routes/savedLists.js';
import backInStockRoutes from './routes/backInStock.js';
import {
  createBackInStockService,
  type BackInStockService,
} from './features/backInStock/backInStockService.js';
import { createBackInStockRepository } from './features/backInStock/backInStockRepository.js';
import { createBackInStockTrigger } from './features/backInStock/backInStockTrigger.js';
import { createBackInStockNotifyHandler } from './features/backInStock/backInStockNotifyHandler.js';
import {
  createSavedListService,
  type SavedListService,
} from './features/savedLists/savedListService.js';
import { createSavedListRepository } from './features/savedLists/savedListRepository.js';
import { DEFAULT_WEBHOOK_SECRET } from './config.js';
import notificationRoutes from './routes/notifications.js';
import standingOrderRoutes from './routes/standingOrders.js';
import webhookRoutes from './routes/webhooks.js';
import adminWebhooksRoutes from './routes/adminWebhooks.js';
import adminJobsRoutes from './routes/adminJobs.js';
import { JobHandlerRegistry } from './features/jobs/jobHandlerRegistry.js';
import { createJobRepository } from './features/jobs/jobRepository.js';
import { JobService } from './features/jobs/jobService.js';
import { createNotificationRepository } from './features/notifications/notificationRepository.js';
import {
  createNotificationService,
  type NotificationService,
} from './features/notifications/notificationService.js';
import { createNotificationDeliveryHandler } from './features/notifications/notificationDeliveryHandler.js';
import { createWebhookRepository } from './features/webhooks/webhookRepository.js';
import { createWebhookService } from './features/webhooks/webhookService.js';
import { createWebhookProcessingHandler } from './features/webhooks/webhookProcessingHandler.js';
import { createStandingOrderRepository } from './features/standingOrders/standingOrderRepository.js';
import {
  createStandingOrderService,
  type StandingOrderService,
} from './features/standingOrders/standingOrderService.js';

/**
 * The buyer's saved trade records, grouped because they are always wired, injected, and consumed
 * as one account surface (routes and checkout both need both halves).
 */
export interface TradeAccountServices {
  sites: DeliverySiteService;
  billingEntities: BillingEntityService;
}

export interface AppDependencies {
  db: Database.Database;
  resetBaseUrl: string;
  clock?: Clock;
  /** Test/integration seam; production composition falls back to the local simulated gateway. */
  paymentGateway?: PaymentGateway;
  resetTokenSource?: ResetTokenSource;
  orderAccessTokenSource?: OrderAccessTokenSource;
  webhookSecret?: string;
}

export interface AppServices {
  auth: AuthService;
  sessions: SessionService;
  passwordReset: PasswordResetService;
  mailbox: MailboxRepository;
  products: ProductService;
  countryProfiles: CountryProfileService;
  carts: CartService;
  promos: PromoService;
  orders: OrderService;
  creditAccounts: CreditAccountService;
  invoices: InvoiceService;
  /** Owner-scoped invoice lookup adapter used by the order detail route. */
  invoiceReader?: OwnedOrderInvoiceReader;
  orderAccess: OrderAccessService;
  checkout: CheckoutService;
  audit: AuditReadService;
  bundles: BundleService;
  reorder: ReorderService;
  quickOrder: QuickOrderService;
  savedLists: SavedListService;
  backInStock: BackInStockService;
  reviews: ReviewService;
  inventory: InventoryService;
  inventoryUnitOfWork: UnitOfWork;
  returns: ReturnService;
  customBlends: CustomBlendService;
  tradeAccount: TradeAccountServices;
  deliverySlots: DeliverySlotService;
  preferences: PreferencesService;
  dataExport: DataExportService;
  accountDeletion: AccountDeletionService;
  companyAccounts: CompanyService;
  approvals: ApprovalService;
  productAdmin: ProductAdminService;
  variantAdmin: VariantAdminService;
  promoAdmin: PromoAdminService;
  userAdmin: UserAdminService;
  orderAdmin: OrderAdminService;
  adminRefunds: AdminRefundService;
  featureFlags: FeatureFlagService;
  featureFlagResolver: FeatureFlagResolver;
  jobs: JobService;
  jobRunner: JobService;
  notifications: NotificationService;
  webhooks: ReturnType<typeof createWebhookService>;
  standingOrders: StandingOrderService;
  clock: Clock;
}

export type AppContext = { services: AppServices };

function createAppServices(dependencies: AppDependencies): AppServices {
  const clock = dependencies.clock ?? { now: () => new Date() };
  const mailbox = createMailboxRepository(dependencies.db);
  const carts = createCartRepository(dependencies.db);
  const promos = createPromoRepository(dependencies.db);
  const orders = createOrderRepository(dependencies.db);
  const products = createProductRepository(dependencies.db);
  const countryProfiles = createCountryProfileService();
  const sessionRepository = createSessionRepository(dependencies.db);
  const companyMemberships = createCompanyMembershipRepository(dependencies.db);
  const featureFlagRepository = createFeatureFlagRepository(dependencies.db);
  const featureFlagResolver = createFeatureFlagResolver(featureFlagRepository);
  const unitOfWork = createUnitOfWork(dependencies.db);
  const auditRepository = createAuditRepository(dependencies.db);
  const audit = createAuditWriter({ repository: auditRepository, clock });
  // Trade-credit persistence and workflows are application singletons. They share the same
  // database, UnitOfWork, clock, and audit writer so checkout, invoice lifecycle, cancellation,
  // and the account/admin routes cannot observe divergent policy or transaction state.
  const creditAccountRepository: CreditAccountRepository = createCreditAccountRepository(
    dependencies.db,
  );
  const creditHoldRepository: CreditHoldRepository = createCreditHoldRepository(dependencies.db);
  const invoiceRepository = createInvoiceRepository(dependencies.db);
  // One resolver instance is shared by cart reads/mutations and the custom-blend routes so every
  // path observes the same live facts, clock, policy, and pricing authority.
  const customBlendResolver = createCustomBlendResolver(
    createCustomBlendRepository(dependencies.db),
    clock,
  );
  const registry = new JobHandlerRegistry();
  const jobs = new JobService({
    repository: createJobRepository(dependencies.db),
    registry,
    unitOfWork,
    clock,
    audit,
    faults: featureFlagResolver,
  });
  const backInStockRepository = createBackInStockRepository(dependencies.db);
  // Constructed before inventory so the observer can be handed to it. The trigger takes no
  // inventory dependency, which is what keeps this ordering acyclic.
  const backInStockTrigger = createBackInStockTrigger({
    repository: backInStockRepository,
    jobs,
    unitOfWork,
    clock,
  });
  const inventory = createInventoryService({
    repository: createInventoryRepository(dependencies.db),
    stockObserver: backInStockTrigger,
  });
  const users = createUserRepository(dependencies.db);
  // Background notifications must use persisted account country, never request/browser state.
  const countryForUser = (userId: number): Country | undefined =>
    users.findCredentialsById(userId)?.country as Country | undefined;
  const sessions = createSessionService({
    sessions: sessionRepository,
    clock,
    unitOfWork,
    audit,
  });
  const preferences = createPreferencesService({
    repository: createPreferencesRepository(dependencies.db),
    unitOfWork,
    audit,
    clock,
  });
  // Hoisted: the slot service reads carts through the same cart service the routes use, so the
  // slot quote can never see a different view of a cart than the cart endpoints do.
  const cartService = createCartService(
    carts,
    { unitOfWork, audit },
    {
      inventory,
      clock,
      countryProfiles,
    },
    customBlendResolver,
  );
  // Hoisted: checkout resolves saved destinations and re-validates slots through the very same
  // service instances the account and slot routes answer from, so no second view can exist.
  const tradeAccount: TradeAccountServices = {
    sites: createDeliverySiteService({
      repository: createDeliverySiteRepository(dependencies.db),
      unitOfWork,
      clock,
    }),
    billingEntities: createBillingEntityService({
      repository: createBillingEntityRepository(dependencies.db),
      unitOfWork,
      clock,
    }),
  };
  const deliverySlots = createDeliverySlotService({ cart: cartService, clock });
  const creditAccounts = createCreditAccountService({
    accounts: creditAccountRepository,
    holds: creditHoldRepository,
    memberships: companyMemberships,
    unitOfWork,
    clock,
    audit,
  });
  const invoices = createInvoiceService({
    repository: invoiceRepository,
    unitOfWork,
    clock,
    audit,
  });
  // Hoisted: reorder reads owned orders through the very same order service the order endpoints
  // answer from, so ownership can never be decided against a second view of an order.
  const orderService = createOrderService({
    repository: orders,
    unitOfWork,
    clock,
    audit,
    inventory,
    invoiceRepository,
    invoices,
  });
  const companyAccounts = createCompanyService({
    companies: createCompanyRepository(dependencies.db),
    memberships: companyMemberships,
    invites: createCompanyInviteRepository(dependencies.db),
    mailbox,
    unitOfWork,
    audit,
    clock,
    baseUrl: dependencies.resetBaseUrl,
  });
  const approvals = createApprovalService({
    approvals: createApprovalRepository(dependencies.db),
    companies: companyAccounts,
    mailbox,
    unitOfWork,
    audit,
    clock,
  });
  const savedLists = createSavedListService({
    repository: createSavedListRepository(dependencies.db),
    variants: products,
    inventory,
    carts: cartService,
    orders: orderService,
    unitOfWork,
    audit,
    clock,
  });
  const backInStock = createBackInStockService({
    repository: backInStockRepository,
    inventory,
    variants: products,
    unitOfWork,
    audit,
    clock,
    countryProfiles,
  });
  const reorder = createReorderService({
    orders: orderService,
    carts: cartService,
    variants: products,
    unitOfWork,
    audit,
    clock,
  });
  const notificationRepository = createNotificationRepository(dependencies.db);
  const notifications = createNotificationService({
    repository: notificationRepository,
    jobs,
    unitOfWork,
    audit,
    clock,
  });
  const paymentRepository = createPaymentRepository(dependencies.db);
  const webhookRepository = createWebhookRepository(dependencies.db);
  const webhooks = createWebhookService({
    repository: webhookRepository,
    jobs,
    unitOfWork,
    audit,
    clock,
    secret: dependencies.webhookSecret ?? DEFAULT_WEBHOOK_SECRET,
  });
  const standingOrders = createStandingOrderService({
    repository: createStandingOrderRepository(dependencies.db),
    savedLists,
    orders: orderService,
    reorder,
    carts: cartService,
    jobs,
    notifications,
    audit,
    unitOfWork,
    clock,
    faults: featureFlagResolver,
    countryForUser,
  });
  registry.register(
    'notification.deliver',
    createNotificationDeliveryHandler({
      repository: notificationRepository,
      preferences,
      mailbox,
      audit,
      clock,
      faults: featureFlagResolver,
      countryForUser,
    }),
  );
  registry.register(
    'webhook.process',
    createWebhookProcessingHandler({
      repository: webhookRepository,
      payments: paymentRepository,
      notifications,
      audit,
      clock,
      faults: featureFlagResolver,
      countryForUser,
    }),
  );
  registry.register(
    'back_in_stock.notify',
    createBackInStockNotifyHandler({
      repository: backInStockRepository,
      notifications,
      inventory,
      unitOfWork,
      audit,
      clock,
      faults: featureFlagResolver,
      countryProfiles,
    }),
  );
  registry.register('standing_order.run', ({ jobId, payload }) =>
    standingOrders.runJob(jobId, payload),
  );
  const dataExport = createDataExportService({
    unitOfWork,
    audit,
    clock,
    sessions,
    orders,
    invoices: invoiceRepository,
    savedLists,
    deliverySites: createDeliverySiteRepository(dependencies.db),
    billingEntities: createBillingEntityRepository(dependencies.db),
    preferences,
    mailbox,
  });
  const accountDeletion = createAccountDeletionService({
    users,
    repository: createAccountDeletionRepository(dependencies.db),
    unitOfWork,
    audit,
    clock,
  });
  // The adapter starts from the server-owned order identity, then resolves and re-checks the
  // invoice through the singleton repository. The route adds the request country boundary; this
  // adapter additionally enforces ownership, trade-credit linkage, company identity, and that
  // the invoice country agrees with the frozen order country.
  const invoiceReader = {
    getOwnedByOrder(orderId: number, userId: number) {
      const order = orders.findOwnedDetail(orderId, userId);
      if (
        !order ||
        order.paymentMethod !== 'trade_credit' ||
        order.companyId === undefined ||
        !Number.isSafeInteger(orderId) ||
        orderId < 1
      ) {
        return undefined;
      }
      const now = clock.now().toISOString();
      const candidate = invoiceRepository.findByOrderId(orderId, now);
      if (!candidate) return undefined;
      const invoiceId = Number(candidate.id);
      if (!Number.isSafeInteger(invoiceId) || invoiceId < 1) return undefined;
      const owned = invoiceRepository.findOwnedById(invoiceId, userId, now);
      if (
        !owned ||
        owned.id !== candidate.id ||
        owned.orderId !== order.id ||
        owned.companyId !== order.companyId ||
        owned.country !== order.country
      ) {
        return undefined;
      }
      return owned;
    },
  };
  return {
    auth: createAuthService({
      users,
      clock,
      unitOfWork,
      audit,
    }),
    sessions,
    passwordReset: createPasswordResetService({
      repository: createPasswordResetRepository(dependencies.db),
      mailbox,
      clock,
      baseUrl: dependencies.resetBaseUrl,
      tokenSource: dependencies.resetTokenSource,
      unitOfWork,
      audit,
    }),
    mailbox,
    products: createProductService(products, { clock, countryProfiles }),
    countryProfiles,
    carts: cartService,
    promos: createPromoService({ promos, carts, clock }),
    orders: orderService,
    creditAccounts,
    invoices,
    invoiceReader,
    orderAccess: createOrderAccessService({
      repository: orders,
      clock,
      tokenSource: dependencies.orderAccessTokenSource,
    }),
    checkout: createCheckoutService({
      unitOfWork,
      carts,
      promos,
      payments: paymentRepository,
      orders,
      mailbox,
      gateway: dependencies.paymentGateway ?? simulatedPaymentGateway,
      clock,
      products,
      audit,
      inventory,
      customBlendResolver,
      countryProfiles,
      approvals,
      companies: companyAccounts,
      creditAccounts,
      invoices,
      tradeAccount,
      deliverySlots,
    }),
    bundles: createBundleService({
      bundles: createBundleRepository(dependencies.db),
      carts,
      unitOfWork,
      audit,
      availability: { inventory, clock },
      countryProfiles,
    }),
    // Shares the cart service's own `unitOfWork`, so the reorder transaction nests over the bulk
    // add's transaction as a savepoint instead of opening a second, competing one.
    reorder,
    quickOrder: createQuickOrderService({
      carts: cartService,
      variants: products,
      countryProfiles,
      unitOfWork,
      audit,
    }),
    savedLists,
    backInStock,
    reviews: createReviewService({
      repository: createReviewRepository(dependencies.db),
      unitOfWork,
      audit,
      clock,
    }),
    inventory,
    inventoryUnitOfWork: unitOfWork,
    returns: createReturnService({
      returnRepository: createReturnRepository(dependencies.db),
      orderRepository: orders,
      unitOfWork,
      clock,
      audit,
      inventory,
      refundGateway: createRefundGateway(),
      resolveVariantId: (orderLineItemId: number) => {
        const row = dependencies.db
          .prepare('SELECT variant_id FROM order_line_items WHERE id = ?')
          .get(orderLineItemId) as { variant_id: number | null } | undefined;
        return row?.variant_id ?? undefined;
      },
    }),
    customBlends: createCustomBlendService(customBlendResolver),
    tradeAccount,
    deliverySlots,
    preferences,
    dataExport,
    accountDeletion,
    companyAccounts,
    approvals,
    productAdmin: createProductAdminService({
      repository: createProductAdminRepository(dependencies.db),
      unitOfWork,
      audit,
      clock,
    }),
    variantAdmin: createVariantAdminService({
      repository: createVariantAdminRepository(dependencies.db),
      unitOfWork,
      audit,
      clock,
      stockObserver: backInStockTrigger,
    }),
    promoAdmin: createPromoAdminService({
      repository: createPromoAdminRepository(dependencies.db),
      unitOfWork,
      audit,
    }),
    userAdmin: createUserAdminService({
      repository: createUserAdminRepository(dependencies.db),
      sessions: sessionRepository,
      unitOfWork,
      audit,
      clock,
    }),
    orderAdmin: createOrderAdminService({
      repository: createOrderAdminRepository(dependencies.db),
      orderRepository: orders,
    }),
    adminRefunds: createAdminRefundService({
      db: dependencies.db,
      unitOfWork,
      audit,
      clock,
      refundGateway: createRefundGateway(),
    }),
    featureFlags: createFeatureFlagService({
      repository: featureFlagRepository,
      resolver: featureFlagResolver,
      unitOfWork,
      audit,
    }),
    featureFlagResolver,
    jobs,
    jobRunner: jobs,
    notifications,
    webhooks,
    standingOrders,
    clock,
    audit: createAuditReadService(auditRepository),
  };
}

/** Build the HTTP application. The caller owns database lifecycle and listening. */
export async function buildApp(dependencies: AppDependencies) {
  const app = Fastify({
    logger: false,
    ajv: { customOptions: { removeAdditional: false } },
  }).withTypeProvider<TypeBoxTypeProvider>();
  const context: AppContext = { services: createAppServices(dependencies) };

  app.setErrorHandler((error: FastifyError, request, reply) => {
    // Fastify parses JSON before preValidation; malformed bodies therefore bypass the
    // validation flag. Keep parser failures on the same public, localized 400 contract.
    if (error.validation || error.code === 'FST_ERR_CTP_INVALID_JSON_BODY') {
      sendPublicError(request, reply, 400, 'REQUEST_INVALID');
      return;
    }
    if (error.statusCode === 404) {
      sendPublicError(request, reply, 404, 'NOT_FOUND');
      return;
    }
    // Do not reflect exception text (or a framework-generated message) to callers. Preserve an
    // explicitly selected HTTP status for compatibility, while the public identity stays generic.
    const statusCode =
      typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode <= 599
        ? error.statusCode
        : 500;
    sendPublicError(request, reply, statusCode, 'INTERNAL_ERROR');
  });

  app.setNotFoundHandler((request, reply) => {
    // Route/method details disclose implementation surface and are not useful to the buyer.
    sendPublicError(request, reply, 404, 'NOT_FOUND');
  });

  app.get('/health', () => ({ status: 'ok' }));

  await app.register(fastifyCookie);
  // Both plugins resolve request-local state in preValidation; registration order is the
  // dependency that guarantees country sees the authenticated account before schema validation.
  authPlugin(context.services.sessions)(app, {}, () => undefined);
  countryContextPlugin(context.services.sessions)(app, {}, () => undefined);
  await app.register(productsRoutes, context);
  await app.register(cartRoutes, context);
  await app.register(promoRoutes, context);
  await app.register(ordersRoutes, context);
  await app.register(tradeCreditRoutes, context);
  await app.register(adminOrdersRoutes, context);
  await app.register(adminCreditRoutes, context);
  await app.register(adminInventoryRoutes, context);
  await app.register(adminProductsRoutes, context);
  await app.register(adminVariantsRoutes, context);
  await app.register(adminPromosRoutes, context);
  await app.register(adminUsersRoutes, context);
  await app.register(adminOrdersListRoutes, context);
  await app.register(adminRefundsRoutes, context);
  await app.register(adminFeatureFlagsRoutes, context);
  await app.register(adminWebhooksRoutes, context);
  await app.register(adminJobsRoutes, context);
  await app.register(authRoutes, context);
  await app.register(paymentRoutes, context);
  await app.register(mailboxRoutes, context);
  await app.register(bundleRoutes, context);
  await app.register(reorderRoutes, context);
  await app.register(quickOrderRoutes, context);
  await app.register(savedListRoutes, context);
  await app.register(backInStockRoutes, context);
  await app.register(notificationRoutes, context);
  await app.register(standingOrderRoutes, context);
  await app.register(webhookRoutes, context);
  await app.register(auditRoutes, context);
  await app.register(reviewsRoutes, context);
  await app.register(returnsRoutes, context);
  await app.register(adminReturnsRoutes, context);
  await app.register(customBlendRoutes, context);
  await app.register(tradeAccountRoutes, context);
  await app.register(deliverySlotRoutes, context);
  await app.register(accountSessionRoutes, context);
  await app.register(accountPreferencesRoutes, context);
  await app.register(accountExportRoutes, context);
  await app.register(accountDeletionRoutes, context);
  await app.register(companyAccountRoutes, context);
  await app.register(orderApprovalRoutes, context);

  return Object.assign(app, { context });
}
