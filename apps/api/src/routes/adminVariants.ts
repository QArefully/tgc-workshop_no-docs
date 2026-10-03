import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import {
  AdminProductVariantsParam,
  AdminVariant,
  AdminVariantIdParam,
  CreateAdminVariantBody,
  SetAdminVariantClearanceBody,
  UpdateAdminVariantBody,
  type AdminVariant as AdminVariantResponse,
} from '@shop/contracts/admin-variants';
import { ErrorResponse } from '@shop/contracts/common';
import type { Country } from '@shop/contracts/country';
import type { FastifyInstance } from 'fastify';
import type { SessionService } from '../features/auth/sessionService.js';
import type { AuditContext } from '../features/audit/auditEvent.js';
import {
  VariantAdminError,
  type VariantAdminService,
} from '../features/catalog/variantAdminService.js';
import type { VariantRow } from '../features/catalog/productRepository.js';
import { requireAdmin } from '../plugins/auth.js';
import { sendPublicError } from '../utils/errors.js';
export interface AdminVariantsRouteServices {
  sessions: SessionService;
  variantAdmin: VariantAdminService;
}
const context = (userId: number, requestId: string, standingCountry: Country): AuditContext => ({
  actor: { type: 'user' as const, userId },
  requestId,
  standingCountry,
});
function deliveryClass(value: string): AdminVariantResponse['deliveryClass'] {
  if (value === 'parcel' || value === 'freight') return value;
  throw new Error('Unexpected delivery class');
}
const map = (v: VariantRow): AdminVariantResponse => ({
  id: String(v.id),
  productId: String(v.product_id),
  sku: v.sku,
  label: v.label,
  weightGrams: v.weight_grams,
  priceCents: v.price_cents,
  moqSacks: v.moq_sacks,
  compareAtPriceCents: v.compare_at_price_cents,
  clearance:
    v.clearance_price_cents === null
      ? null
      : {
          priceCents: v.clearance_price_cents,
          startsAt: v.clearance_starts_at!,
          endsAt: v.clearance_ends_at!,
        },
  stockCount: v.stock_count,
  backorderable: v.backorderable === 1,
  backorderLeadDays: v.backorder_lead_days,
  deliveryClass: deliveryClass(v.delivery_class),
  active: v.active === 1,
  sortOrder: v.sort_order,
  createdAt: v.created_at,
  updatedAt: v.updated_at,
});
const mapWithCountry = (v: VariantRow) => ({
  ...map(v),
  blockedInCountry: v.blocked_in_country === 1,
});
const AdminVariantWithCountry = Type.Intersect([
  AdminVariant,
  Type.Object({ blockedInCountry: Type.Boolean() }, { additionalProperties: false }),
]);
const AdminVariantWithCountryListResponse = Type.Object(
  { items: Type.Array(AdminVariantWithCountry) },
  { additionalProperties: false },
);
function sendError(
  request: Parameters<typeof sendPublicError>[0],
  reply: Parameters<typeof sendPublicError>[1],
  e: VariantAdminError,
) {
  if (e.code === 'VARIANT_NOT_FOUND')
    return sendPublicError(request, reply, 404, 'VARIANT_NOT_FOUND');
  if (e.code === 'VARIANT_RETIRED') return sendPublicError(request, reply, 409, 'VARIANT_RETIRED');
  if (e.code === 'VARIANT_NO_ACTIVE_REPLACEMENT')
    return sendPublicError(request, reply, 409, 'VARIANT_NO_ACTIVE_REPLACEMENT');
  if (e.code === 'INVALID_CLEARANCE')
    return sendPublicError(request, reply, 400, 'INVALID_CLEARANCE');
  return sendPublicError(request, reply, 400, 'INVALID_VARIANT');
}
export default function adminVariantsRoutes(
  app: FastifyInstance,
  { services }: { services: AdminVariantsRouteServices },
): void {
  app.addHook('preValidation', requireAdmin(services.sessions));
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();
  typed.get(
    '/api/admin/products/:productId/variants',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        params: AdminProductVariantsParam,
        response: {
          200: AdminVariantWithCountryListResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    (r, reply) => {
      try {
        return {
          items: services.variantAdmin
            .listAdmin(Number(r.params.productId), r.resolvedCountry)
            .map(mapWithCountry),
        };
      } catch (e) {
        if (e instanceof VariantAdminError) return sendError(r, reply, e);
        throw e;
      }
    },
  );
  typed.post(
    '/api/admin/variants',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        body: CreateAdminVariantBody,
        response: { 201: AdminVariant, 400: ErrorResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    (r, reply) => {
      try {
        reply.code(201);
        return map(
          services.variantAdmin.create(
            { ...r.body, productId: Number(r.body.productId) },
            context(r.authenticatedUser!.id, r.id, r.resolvedCountry),
          ),
        );
      } catch (e) {
        if (e instanceof VariantAdminError) return sendError(r, reply, e);
        throw e;
      }
    },
  );
  typed.patch(
    '/api/admin/variants/:variantId',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        params: AdminVariantIdParam,
        body: UpdateAdminVariantBody,
        response: {
          200: AdminVariant,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    (r, reply) => {
      try {
        return map(
          services.variantAdmin.update(
            Number(r.params.variantId),
            r.body,
            context(r.authenticatedUser!.id, r.id, r.resolvedCountry),
          ),
        );
      } catch (e) {
        if (e instanceof VariantAdminError) return sendError(r, reply, e);
        throw e;
      }
    },
  );
  typed.delete(
    '/api/admin/variants/:variantId',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        params: AdminVariantIdParam,
        response: {
          200: AdminVariant,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    (r, reply) => {
      try {
        return map(
          services.variantAdmin.retire(
            Number(r.params.variantId),
            context(r.authenticatedUser!.id, r.id, r.resolvedCountry),
          ),
        );
      } catch (e) {
        if (e instanceof VariantAdminError) return sendError(r, reply, e);
        throw e;
      }
    },
  );
  typed.put(
    '/api/admin/variants/:variantId/clearance',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        params: AdminVariantIdParam,
        body: SetAdminVariantClearanceBody,
        response: {
          200: AdminVariant,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    (r, reply) => {
      try {
        return map(
          services.variantAdmin.setClearance(
            Number(r.params.variantId),
            r.body.clearance,
            context(r.authenticatedUser!.id, r.id, r.resolvedCountry),
          ),
        );
      } catch (e) {
        if (e instanceof VariantAdminError) return sendError(r, reply, e);
        throw e;
      }
    },
  );
}
