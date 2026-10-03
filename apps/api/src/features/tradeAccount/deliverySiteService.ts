import type {
  CreateDeliverySiteBody,
  DeliverySite,
  UpdateDeliverySiteBody,
} from '@shop/contracts/trade-account';
import { countryProfile } from '@shop/contracts/country-profiles';
import type { UnitOfWork } from '../../db/unitOfWork.js';
import type { Clock } from '../audit/auditService.js';
import {
  isDeliverableCountryCode,
  normalizeOptionalText,
  normalizePostalAddress,
  normalizeText,
  toAddressColumns,
  type AddressColumns,
  validatePostcodeForCountry,
} from './addressRules.js';
import {
  toDeliverySite,
  type DeliverySiteRepository,
  type DeliverySiteRow,
  type DeliverySiteUpdate,
} from './deliverySiteRepository.js';
import {
  tradeAccountError,
  tradeAccountOk,
  type TradeAccountResult,
} from './tradeAccountErrors.js';

/**
 * Per-user cap on live delivery sites. A trade buyer runs branches, yards, and sites, so the bound
 * is generous; it exists only to keep one account from turning the address book into unbounded
 * storage. Retired sites do not count against it.
 */
export const MAX_DELIVERY_SITES_PER_USER = 25;

export interface DeliverySiteService {
  /** Live sites only, default first. */
  list(userId: number): DeliverySite[];
  /** Live site owned by `userId`, else `SITE_NOT_FOUND`. Never reveals another user's row. */
  get(userId: number, siteId: number): TradeAccountResult<DeliverySite>;
  /**
   * Site owned by `userId` regardless of `active`, for hydrating an order that snapshotted a site
   * later retired. Not a checkout destination resolver: checkout must use `get`.
   */
  findForOrderHydration(userId: number, siteId: number): DeliverySite | null;
  create(userId: number, body: CreateDeliverySiteBody): TradeAccountResult<DeliverySite>;
  update(
    userId: number,
    siteId: number,
    body: UpdateDeliverySiteBody,
  ): TradeAccountResult<DeliverySite>;
  setDefault(userId: number, siteId: number): TradeAccountResult<DeliverySite>;
  /** Retires the site (`active = 0`). Never deletes; orders keep their foreign key. */
  retire(userId: number, siteId: number): TradeAccountResult<null>;
}

export interface DeliverySiteServiceDependencies {
  repository: DeliverySiteRepository;
  unitOfWork: UnitOfWork;
  clock: Clock;
}

export function createDeliverySiteService({
  repository,
  unitOfWork,
  clock,
}: DeliverySiteServiceDependencies): DeliverySiteService {
  const nowIso = () => clock.now().toISOString();

  /**
   * Duplicate-label guard. Matched case-insensitively and against live rows only, mirroring the
   * partial unique index while being deliberately stricter about casing: two sites differing only
   * in case are indistinguishable in a picker. Pre-checking here is what keeps a raw
   * `SQLITE_CONSTRAINT` from ever reaching a route.
   */
  const labelTaken = (userId: number, label: string, excludeSiteId: number | null): boolean => {
    const existing = repository.findActiveByLabel(userId, label);
    return existing !== undefined && existing.id !== excludeSiteId;
  };

  /** Promotes `siteId` and clears any prior default. Caller owns the transaction. */
  const applyDefault = (userId: number, siteId: number, now: string): void => {
    repository.clearDefault(userId, now);
    repository.markDefault(userId, siteId, now);
  };

  const reload = (userId: number, siteId: number): DeliverySiteRow =>
    repository.findById(userId, siteId) as DeliverySiteRow;

  const validatedAddress = (userId: number, address: CreateDeliverySiteBody['address']) => {
    const normalized = normalizePostalAddress(address);
    const country = repository.accountCountry(userId);
    if (!country) return tradeAccountError<AddressColumns>('SITE_NOT_FOUND');
    const profile = countryProfile(country);
    if (!validatePostcodeForCountry(profile, normalized.postcode)) {
      return tradeAccountError<AddressColumns>('INVALID_POSTCODE');
    }
    if (!isDeliverableCountryCode(profile, normalized.countryCode)) {
      return tradeAccountError<AddressColumns>(
        'DELIVERY_COUNTRY_NOT_ALLOWED',
        'This delivery country is not available for your account.',
      );
    }
    return tradeAccountOk(toAddressColumns(normalized));
  };

  return {
    list(userId) {
      return repository.listActive(userId).map(toDeliverySite);
    },

    get(userId, siteId) {
      const row = repository.findActiveById(userId, siteId);
      if (!row) return tradeAccountError('SITE_NOT_FOUND');
      return tradeAccountOk(toDeliverySite(row));
    },

    findForOrderHydration(userId, siteId) {
      const row = repository.findById(userId, siteId);
      return row ? toDeliverySite(row) : null;
    },

    create(userId, body) {
      const label = normalizeText(body.label);
      const address = validatedAddress(userId, body.address);
      if (!address.ok) return address;
      if (repository.countActive(userId) >= MAX_DELIVERY_SITES_PER_USER) {
        return tradeAccountError('SITE_LIMIT_REACHED');
      }
      if (labelTaken(userId, label, null)) return tradeAccountError('DUPLICATE_LABEL');

      const now = nowIso();
      // The first live site of an account is always the default: an account with sites but no
      // default would leave checkout with nothing to preselect and no way for the buyer to tell.
      const isDefault = body.isDefault === true || repository.countActive(userId) === 0;

      const row = unitOfWork.run(() => {
        const inserted = repository.insert({
          user_id: userId,
          label,
          contact_name: normalizeText(body.contactName),
          contact_phone: normalizeOptionalText(body.contactPhone),
          ...address.value,
          is_default: false,
          now,
        });
        if (isDefault) applyDefault(userId, inserted.id, now);
        return reload(userId, inserted.id);
      });
      return tradeAccountOk(toDeliverySite(row));
    },

    update(userId, siteId, body) {
      const current = repository.findActiveById(userId, siteId);
      if (!current) return tradeAccountError('SITE_NOT_FOUND');

      const patch: DeliverySiteUpdate = {};
      if (body.label !== undefined) {
        const label = normalizeText(body.label);
        if (labelTaken(userId, label, siteId)) return tradeAccountError('DUPLICATE_LABEL');
        patch.label = label;
      }
      if (body.contactName !== undefined) patch.contact_name = normalizeText(body.contactName);
      if (body.contactPhone !== undefined) {
        patch.contact_phone = normalizeOptionalText(body.contactPhone);
      }
      if (body.address !== undefined) {
        const address = validatedAddress(userId, body.address);
        if (!address.ok) return address;
        Object.assign(patch, address.value);
      }

      const now = nowIso();
      const row = unitOfWork.run(() => {
        repository.update(userId, siteId, patch, now);
        // `isDefault: false` never demotes. Dropping the flag here would leave the account with no
        // default at all; the default moves only by promoting another site.
        if (body.isDefault === true) applyDefault(userId, siteId, now);
        return reload(userId, siteId);
      });
      return tradeAccountOk(toDeliverySite(row));
    },

    setDefault(userId, siteId) {
      const current = repository.findActiveById(userId, siteId);
      if (!current) return tradeAccountError('SITE_NOT_FOUND');

      const now = nowIso();
      // Clear-then-set runs as one transaction: a partial application would either leave two
      // defaults (violating the partial unique index) or none.
      const row = unitOfWork.run(() => {
        applyDefault(userId, siteId, now);
        return reload(userId, siteId);
      });
      return tradeAccountOk(toDeliverySite(row));
    },

    retire(userId, siteId) {
      const current = repository.findActiveById(userId, siteId);
      if (!current) return tradeAccountError('SITE_NOT_FOUND');

      const now = nowIso();
      unitOfWork.run(() => {
        repository.retire(userId, siteId, now);
        // Retiring the default promotes the oldest surviving site, so an account that still has
        // sites always has exactly one default.
        if (current.is_default === 1) {
          const successor = repository.findOldestActive(userId, siteId);
          if (successor) applyDefault(userId, successor.id, now);
        }
      });
      return tradeAccountOk(null);
    },
  };
}
