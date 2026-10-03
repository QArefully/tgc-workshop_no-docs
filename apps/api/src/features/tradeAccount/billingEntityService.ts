import type {
  BillingEntity,
  CreateBillingEntityBody,
  UpdateBillingEntityBody,
} from '@shop/contracts/trade-account';
import type { UnitOfWork } from '../../db/unitOfWork.js';
import type { Clock } from '../audit/auditService.js';
import { normalizeOptionalText, normalizeText, toAddressColumns } from './addressRules.js';
import {
  toBillingEntity,
  type BillingEntityRepository,
  type BillingEntityRow,
  type BillingEntityUpdate,
} from './billingEntityRepository.js';
import {
  tradeAccountError,
  tradeAccountOk,
  type TradeAccountResult,
} from './tradeAccountErrors.js';

/**
 * Per-user cap on live billing entities. Lower than the delivery-site cap: an account bills through
 * a handful of legal entities even when it delivers to many sites. Retired entities do not count.
 */
export const MAX_BILLING_ENTITIES_PER_USER = 10;

export interface BillingEntityService {
  /** Live entities only, default first. */
  list(userId: number): BillingEntity[];
  /** Live entity owned by `userId`, else `BILLING_ENTITY_NOT_FOUND`. Never reveals another user's row. */
  get(userId: number, entityId: number): TradeAccountResult<BillingEntity>;
  /**
   * Entity owned by `userId` regardless of `active`, for hydrating an order that snapshotted an
   * entity later retired. Not a checkout billing resolver: checkout must use `get`.
   */
  findForOrderHydration(userId: number, entityId: number): BillingEntity | null;
  create(userId: number, body: CreateBillingEntityBody): TradeAccountResult<BillingEntity>;
  update(
    userId: number,
    entityId: number,
    body: UpdateBillingEntityBody,
  ): TradeAccountResult<BillingEntity>;
  setDefault(userId: number, entityId: number): TradeAccountResult<BillingEntity>;
  /** Retires the entity (`active = 0`). Never deletes; order snapshots stay readable. */
  retire(userId: number, entityId: number): TradeAccountResult<null>;
}

export interface BillingEntityServiceDependencies {
  repository: BillingEntityRepository;
  unitOfWork: UnitOfWork;
  clock: Clock;
}

export function createBillingEntityService({
  repository,
  unitOfWork,
  clock,
}: BillingEntityServiceDependencies): BillingEntityService {
  const nowIso = () => clock.now().toISOString();

  /**
   * Duplicate legal-name guard: live rows only, case-insensitive. Mirrors the partial unique index
   * while being stricter about casing, so a raw `SQLITE_CONSTRAINT` never reaches a route.
   */
  const legalNameTaken = (
    userId: number,
    legalName: string,
    excludeEntityId: number | null,
  ): boolean => {
    const existing = repository.findActiveByLegalName(userId, legalName);
    return existing !== undefined && existing.id !== excludeEntityId;
  };

  /** Promotes `entityId` and clears any prior default. Caller owns the transaction. */
  const applyDefault = (userId: number, entityId: number, now: string): void => {
    repository.clearDefault(userId, now);
    repository.markDefault(userId, entityId, now);
  };

  const reload = (userId: number, entityId: number): BillingEntityRow =>
    repository.findById(userId, entityId) as BillingEntityRow;

  return {
    list(userId) {
      return repository.listActive(userId).map(toBillingEntity);
    },

    get(userId, entityId) {
      const row = repository.findActiveById(userId, entityId);
      if (!row) return tradeAccountError('BILLING_ENTITY_NOT_FOUND');
      return tradeAccountOk(toBillingEntity(row));
    },

    findForOrderHydration(userId, entityId) {
      const row = repository.findById(userId, entityId);
      return row ? toBillingEntity(row) : null;
    },

    create(userId, body) {
      const legalName = normalizeText(body.legalName);
      if (repository.countActive(userId) >= MAX_BILLING_ENTITIES_PER_USER) {
        return tradeAccountError('BILLING_ENTITY_LIMIT_REACHED');
      }
      if (legalNameTaken(userId, legalName, null)) {
        return tradeAccountError('DUPLICATE_LEGAL_NAME');
      }

      const now = nowIso();
      // First live entity of an account is always the default, so checkout always has something to
      // preselect once the buyer has saved billing details at all.
      const isDefault = body.isDefault === true || repository.countActive(userId) === 0;

      const row = unitOfWork.run(() => {
        const inserted = repository.insert({
          user_id: userId,
          legal_name: legalName,
          registration_number: normalizeOptionalText(body.registrationNumber),
          vat_number: normalizeOptionalText(body.vatNumber),
          ...toAddressColumns(body.address),
          is_default: false,
          now,
        });
        if (isDefault) applyDefault(userId, inserted.id, now);
        return reload(userId, inserted.id);
      });
      return tradeAccountOk(toBillingEntity(row));
    },

    update(userId, entityId, body) {
      const current = repository.findActiveById(userId, entityId);
      if (!current) return tradeAccountError('BILLING_ENTITY_NOT_FOUND');

      const patch: BillingEntityUpdate = {};
      if (body.legalName !== undefined) {
        const legalName = normalizeText(body.legalName);
        if (legalNameTaken(userId, legalName, entityId)) {
          return tradeAccountError('DUPLICATE_LEGAL_NAME');
        }
        patch.legal_name = legalName;
      }
      // `undefined` (key absent) and `null` are distinct instructions and must stay distinct all the
      // way to SQL: absent skips the column entirely, `null` normalises to NULL and clears it. The
      // repository's update builder skips only `undefined`, so a `null` here really does write NULL.
      if (body.registrationNumber !== undefined) {
        patch.registration_number = normalizeOptionalText(body.registrationNumber);
      }
      if (body.vatNumber !== undefined) patch.vat_number = normalizeOptionalText(body.vatNumber);
      if (body.address !== undefined) Object.assign(patch, toAddressColumns(body.address));

      const now = nowIso();
      const row = unitOfWork.run(() => {
        repository.update(userId, entityId, patch, now);
        // `isDefault: false` never demotes; the default moves only by promoting another entity.
        if (body.isDefault === true) applyDefault(userId, entityId, now);
        return reload(userId, entityId);
      });
      return tradeAccountOk(toBillingEntity(row));
    },

    setDefault(userId, entityId) {
      const current = repository.findActiveById(userId, entityId);
      if (!current) return tradeAccountError('BILLING_ENTITY_NOT_FOUND');

      const now = nowIso();
      // Clear-then-set is one transaction: a partial application would leave either two defaults
      // (violating the partial unique index) or none.
      const row = unitOfWork.run(() => {
        applyDefault(userId, entityId, now);
        return reload(userId, entityId);
      });
      return tradeAccountOk(toBillingEntity(row));
    },

    retire(userId, entityId) {
      const current = repository.findActiveById(userId, entityId);
      if (!current) return tradeAccountError('BILLING_ENTITY_NOT_FOUND');

      const now = nowIso();
      unitOfWork.run(() => {
        repository.retire(userId, entityId, now);
        // Retiring the default promotes the oldest survivor, keeping exactly one default whenever
        // the account still has entities.
        if (current.is_default === 1) {
          const successor = repository.findOldestActive(userId, entityId);
          if (successor) applyDefault(userId, successor.id, now);
        }
      });
      return tradeAccountOk(null);
    },
  };
}
