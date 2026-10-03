import type Database from 'better-sqlite3';
import type { PostalAddress } from '@shop/contracts/address';
import type { DeliverySlot } from '@shop/contracts/delivery';
import { FREIGHT_HEAVY_WEIGHT_THRESHOLD_GRAMS } from '@shop/contracts/delivery';
import { countryProfile } from '@shop/contracts/country-profiles';
import type { BillingSelection, DeliveryDestination } from '@shop/contracts/payments';
import { createCartRepository } from '../../src/features/cart/cartRepository.js';
import { createCartService } from '../../src/features/cart/cartService.js';
import { calculateLeadTime } from '../../src/features/delivery/deliverySlotRules.js';
import { createDeliverySlotService } from '../../src/features/delivery/deliverySlotService.js';
import { createBillingEntityRepository } from '../../src/features/tradeAccount/billingEntityRepository.js';
import { createBillingEntityService } from '../../src/features/tradeAccount/billingEntityService.js';
import { createDeliverySiteRepository } from '../../src/features/tradeAccount/deliverySiteRepository.js';
import { createDeliverySiteService } from '../../src/features/tradeAccount/deliverySiteService.js';
import { createUnitOfWork } from '../../src/db/unitOfWork.js';
import type { Clock } from '../../src/features/auth/authService.js';

/**
 * Shared checkout-depth fixtures. Checkout now requires a destination, a billed party, and a
 * bookable slot on every call, so every suite that pays for something needs these; one module keeps
 * the shapes in step with the contracts instead of scattering literals across suites.
 */

export const testPostalAddress: PostalAddress = {
  line1: '1 Test Street',
  city: 'Testville',
  postcode: 'TS1 1TS',
  countryCode: 'GB',
};

export const adhocDestination: DeliveryDestination = {
  kind: 'adhoc',
  address: testPostalAddress,
};

export const adhocBilling: BillingSelection = {
  kind: 'adhoc',
  billingEntity: { legalName: 'Test Buyer Ltd', address: testPostalAddress },
};

/**
 * A slot every consignment can book.
 *
 * The heaviest freight step has the latest earliest-date and the shortest remaining horizon, so its
 * earliest date is inside the bookable window of every lighter cart as well. A suite therefore never
 * has to know its own cart weight to pick a valid slot.
 */
export function bookableSlot(now: Date = new Date()): DeliverySlot {
  const leadTime = calculateLeadTime({
    deliverySummary: { mode: 'freight', weightGrams: FREIGHT_HEAVY_WEIGHT_THRESHOLD_GRAMS },
    now,
    profile: countryProfile('UK'),
  });
  return { date: leadTime.earliestDate, window: 'am' };
}

/** The trade-account and slot halves of `CheckoutDependencies`, wired against one database. */
export function checkoutDepthDependencies(db: Database.Database, clock: Clock) {
  const unitOfWork = createUnitOfWork(db);
  return {
    tradeAccount: {
      sites: createDeliverySiteService({
        repository: createDeliverySiteRepository(db),
        unitOfWork,
        clock,
      }),
      billingEntities: createBillingEntityService({
        repository: createBillingEntityRepository(db),
        unitOfWork,
        clock,
      }),
    },
    deliverySlots: createDeliverySlotService({
      cart: createCartService(createCartRepository(db)),
      clock,
    }),
  };
}
