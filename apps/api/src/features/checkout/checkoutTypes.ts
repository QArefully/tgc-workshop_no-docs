import type { Order } from '@shop/contracts/orders';
import type { PostalAddress } from '@shop/contracts/address';
import type { DeliveryDate, DeliverySlot } from '@shop/contracts/delivery';
import type {
  BillingSelection,
  DeliveryDestination,
  PaymentMethod,
} from '@shop/contracts/payments';
import type { BillingEntitySnapshot } from '@shop/contracts/trade-account';
import type { Clock } from '../auth/authService.js';
import type { DeliverySlotService } from '../delivery/deliverySlotService.js';
import type { BillingEntityService } from '../tradeAccount/billingEntityService.js';
import type { DeliverySiteService } from '../tradeAccount/deliverySiteService.js';
import type { UnitOfWork } from '../../db/unitOfWork.js';
import type { CartRepository } from '../cart/cartRepository.js';
import type { MailboxRepository } from '../mailbox/mailboxRepository.js';
import type { PaymentGateway } from '../payments/paymentGateway.js';
import type { PaymentRepository } from '../payments/paymentRepository.js';
import type { PromoRepository } from '../promos/promoRepository.js';
import type { OrderRepository } from '../orders/orderRepository.js';
import type { ProductRepository } from '../catalog/productRepository.js';
import type { AuditContext } from '../audit/auditEvent.js';
import type { AuditWriter } from '../audit/auditService.js';
import type { InventoryService } from '../inventory/inventoryService.js';
import type { ApprovalService } from '../orderApprovals/approvalService.js';
import type { CompanyService } from '../companyAccounts/companyService.js';
import type { CountryProfileService } from '../countryProfile/countryProfileService.js';
import type { CustomBlendResolver } from '../customBlend/customBlendResolver.js';
import type { CreditAccountService } from '../tradeCredit/creditAccountService.js';
import type { InvoiceService } from '../invoices/invoiceService.js';

export type CheckoutErrorCode =
  | 'CART_NOT_FOUND'
  | 'CART_EMPTY'
  | 'PROMO_INVALID'
  | 'CARD_INVALID'
  | 'DECLINED'
  | 'TIMEOUT'
  | 'IDEMPOTENT_CONFLICT'
  | 'IDEMPOTENT_IN_PROGRESS'
  | 'RESERVATION_EXPIRED'
  | 'INSUFFICIENT_STOCK'
  | 'BLOCKED_IN_COUNTRY'
  | 'DELIVERY_COUNTRY_NOT_ALLOWED'
  | 'BELOW_MOQ'
  /** A configured Custom Blend line no longer resolves to eligible catalog facts. */
  | 'CUSTOM_BLEND_INVALID'
  /**
   * The selected saved delivery site does not resolve for this buyer: unknown, retired, owned by
   * another user, or selected by an anonymous checkout. One code for all four so the response can
   * never be used to probe which sites exist.
   */
  | 'DELIVERY_SITE_NOT_FOUND'
  /** Same rule, same non-disclosure, for the selected saved billing entity. */
  | 'BILLING_ENTITY_INVALID'
  /** The submitted slot is no longer bookable against the lead time re-derived at preparation. */
  | 'DELIVERY_SLOT_UNAVAILABLE'
  | 'PENDING_APPROVAL'
  | 'APPROVAL_REJECTED'
  | 'APPROVAL_EXPIRED'
  | 'APPROVAL_TOTAL_DRIFT'
  | 'CREDIT_NOT_ELIGIBLE'
  | 'CREDIT_ACCOUNT_ON_HOLD'
  | 'CREDIT_ACCOUNT_SUSPENDED'
  | 'CREDIT_LIMIT_EXCEEDED'
  | 'CREDIT_PAYMENT_UNAVAILABLE'
  | 'COMPANY_REQUIRED'
  | 'PAYMENT_METHOD_INVALID'
  | 'CARD_FIELDS_FORBIDDEN'
  | 'CHECKOUT_FAILED';

export type CheckoutResult =
  | { success: true; order: Order }
  | {
      success: false;
      error: Exclude<
        CheckoutErrorCode,
        | 'RESERVATION_EXPIRED'
        | 'INSUFFICIENT_STOCK'
        | 'BLOCKED_IN_COUNTRY'
        | 'DELIVERY_SLOT_UNAVAILABLE'
        | 'PENDING_APPROVAL'
        | 'APPROVAL_REJECTED'
        | 'APPROVAL_EXPIRED'
        | 'APPROVAL_TOTAL_DRIFT'
        | 'BELOW_MOQ'
        | 'CREDIT_LIMIT_EXCEEDED'
        | 'CREDIT_NOT_ELIGIBLE'
        | 'CREDIT_ACCOUNT_ON_HOLD'
        | 'CREDIT_ACCOUNT_SUSPENDED'
        | 'CREDIT_PAYMENT_UNAVAILABLE'
        | 'COMPANY_REQUIRED'
        | 'PAYMENT_METHOD_INVALID'
        | 'CARD_FIELDS_FORBIDDEN'
      >;
      promoError?: string;
      promoErrorCode?: string;
      /** Canonical GBP pence threshold for a failed MIN_SUBTOTAL promotion gate. */
      minSubtotalCents?: number;
    }
  | { success: false; error: 'RESERVATION_EXPIRED'; reservationExpiresAt: string }
  | { success: false; error: 'INSUFFICIENT_STOCK'; productIds: string[] }
  | { success: false; error: 'BLOCKED_IN_COUNTRY'; productIds: string[] }
  | { success: false; error: 'BELOW_MOQ'; minQuantity: number }
  | { success: false; error: 'PENDING_APPROVAL'; approvalRequestId: string }
  | { success: false; error: 'APPROVAL_REJECTED' | 'APPROVAL_EXPIRED' | 'APPROVAL_TOTAL_DRIFT' }
  | {
      success: false;
      error: 'CREDIT_LIMIT_EXCEEDED';
      requestedCents: number;
      availableCreditCents: number;
    }
  | {
      success: false;
      error:
        | 'CREDIT_NOT_ELIGIBLE'
        | 'CREDIT_ACCOUNT_ON_HOLD'
        | 'CREDIT_ACCOUNT_SUSPENDED'
        | 'CREDIT_PAYMENT_UNAVAILABLE'
        | 'COMPANY_REQUIRED'
        | 'PAYMENT_METHOD_INVALID'
        | 'CARD_FIELDS_FORBIDDEN';
    }
  /** Carries the freshly derived earliest bookable date so the buyer can rebook without a round trip. */
  | { success: false; error: 'DELIVERY_SLOT_UNAVAILABLE'; earliestDate: DeliveryDate };

export interface CheckoutParams {
  cartId: string;
  promoCode?: string;
  customerName: string;
  customerEmail: string;
  /**
   * Where the consignment goes. A `saved` selection carries only an identifier: the server loads
   * the stored site and never trusts a client-supplied address for it.
   */
  deliveryDestination: DeliveryDestination;
  /** Who is billed. Same server-authoritative resolution rule as the destination. */
  billingSelection: BillingSelection;
  deliverySlot: DeliverySlot;
  purchaseOrderReference?: string;
  /** Required only for the card method. Trade-credit requests must omit all card fields. */
  cardNumber?: string;
  cardExpiry?: string;
  cardCvc?: string;
  /** Omitted preserves the historic simulated-card request shape. */
  paymentMethod?: PaymentMethod;
  idempotencyKey: string;
  userId: number | null;
  auditContext: AuditContext;
}

/**
 * The buyer's delivery and billing commitments after server-side resolution. Produced inside the
 * preparation transaction and consumed only by the quote, so nothing downstream re-reads a client
 * value or re-resolves a saved record.
 */
export interface ResolvedCheckoutCommitments {
  /** The saved site the address came from, or `null` for an ad-hoc destination. */
  deliverySiteId: number | null;
  deliveryAddress: PostalAddress;
  billingEntity: BillingEntitySnapshot;
  deliverySlot: DeliverySlot;
  purchaseOrderReference: string | null;
}

export interface CheckoutDependencies {
  unitOfWork: UnitOfWork;
  carts: CartRepository;
  promos: PromoRepository;
  payments: PaymentRepository;
  orders: OrderRepository;
  mailbox: MailboxRepository;
  /** Canonical invoice capability required before a trade-credit finalization can write. */
  invoices?: Pick<InvoiceService, 'issue'>;
  /** Compatibility alias used while composition roots converge on the `invoices` name. */
  invoiceService?: Pick<InvoiceService, 'issue'>;
  gateway: PaymentGateway;
  clock: Clock;
  products: ProductRepository;
  audit: AuditWriter;
  inventory: InventoryService;
  /**
   * The application singleton used to rehydrate configured lines at the checkout boundary. It is
   * optional only for legacy direct callers that can contain plain lines; app composition always
   * supplies it so checkout and cart reads share one live-fact authority.
   */
  customBlendResolver?: CustomBlendResolver;
  /** Production composition always supplies the checked-in country availability policy. */
  countryProfiles?: Pick<CountryProfileService, 'isCategoryBlocked' | 'isProductBlocked'>;
  /** Optional only during composition convergence; production checkout wires both services. */
  approvals?: ApprovalService;
  companies?: CompanyService;
  /** Company credit authority and exposure-hold workflow. */
  creditAccounts?: CreditAccountService;
  /** Resolves saved destinations and billing parties owned by the authenticated buyer. */
  tradeAccount: { sites: DeliverySiteService; billingEntities: BillingEntityService };
  /**
   * Re-derives the bookable window from the live cart. Checkout re-validates through the same
   * service the slot endpoint answers from, so an offered slot and an accepted slot cannot drift.
   */
  deliverySlots: DeliverySlotService;
}

export interface CheckoutService {
  process(params: CheckoutParams): Promise<CheckoutResult>;
}
