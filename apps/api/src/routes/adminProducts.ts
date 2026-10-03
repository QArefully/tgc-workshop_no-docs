import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import {
  AdminProduct,
  AdminProductIdParam,
  AdminProductListQuery,
  CreateAdminProductBody,
  UpdateAdminProductBody,
  type AdminCatalogCategory,
  type AdminMixingGroup,
  type AdminProduct as AdminProductResponse,
} from '@shop/contracts/admin-products';
import { ErrorResponse } from '@shop/contracts/common';
import type { Country } from '@shop/contracts/country';
import type { FastifyInstance } from 'fastify';
import type { SessionService } from '../features/auth/sessionService.js';
import type { AuditContext } from '../features/audit/auditEvent.js';
import {
  ProductAdminError,
  type ProductAdminService,
} from '../features/catalog/productAdminService.js';
import type { ProductRow } from '../features/catalog/productRepository.js';
import { requireAdmin } from '../plugins/auth.js';
import { sendPublicError } from '../utils/errors.js';

export interface AdminProductsRouteServices {
  sessions: SessionService;
  productAdmin: ProductAdminService;
}
const context = (userId: number, requestId: string, standingCountry: Country): AuditContext => ({
  actor: { type: 'user' as const, userId },
  requestId,
  standingCountry,
});
function category(value: string): AdminCatalogCategory {
  switch (value) {
    case 'Sports Nutrition':
    case 'Baking & Pantry':
    case 'Drinks':
    case 'Household & Cleaning':
    case 'Garden & Outdoors':
    case 'Trade & Creative Materials':
      return value;
    default:
      throw new Error('Unexpected product category');
  }
}
function consumptionClassification(
  value: string,
): AdminProductResponse['consumptionClassification'] {
  switch (value) {
    case 'food':
    case 'non-food':
    case 'caution':
      return value;
    default:
      throw new Error('Unexpected consumption classification');
  }
}
function mixingGroup(value: string | null): AdminMixingGroup | null {
  if (value === null) return null;
  switch (value) {
    case 'food-grade':
    case 'cleaning':
    case 'garden-treatment':
    case 'cementitious-materials':
    case 'casting-materials':
    case 'pigments':
    case 'theatrical-effects':
    case 'absorbents':
      return value;
    default:
      throw new Error('Unexpected mixing group');
  }
}
const map = (p: ProductRow): AdminProductResponse => ({
  id: String(p.id),
  name: p.name,
  description: p.description,
  priceCents: p.price_cents,
  category: category(p.category),
  stockCount: p.stock_count,
  imageSetId: p.image_set_id,
  slug: p.slug,
  compareAtPriceCents: p.compare_at_price_cents,
  salesCount: p.sales_count,
  active: p.active === 1,
  createdAt: p.created_at,
  consumptionClassification: consumptionClassification(p.consumption_classification),
  mixingGroup: mixingGroup(p.mixing_group),
  detailsJson: p.details_json,
  defaultVariantId: p.default_variant_id === null ? null : String(p.default_variant_id),
  blendSourceVariantId:
    p.blend_source_variant_id === null ? null : String(p.blend_source_variant_id),
});
const mapWithCountry = (p: ProductRow) => ({
  ...map(p),
  blockedInCountry: p.blocked_in_country === 1,
});
const AdminProductWithCountry = Type.Intersect([
  AdminProduct,
  Type.Object({ blockedInCountry: Type.Boolean() }, { additionalProperties: false }),
]);
const AdminProductWithCountryListResponse = Type.Object(
  { items: Type.Array(AdminProductWithCountry) },
  { additionalProperties: false },
);
function sendError(
  request: Parameters<typeof sendPublicError>[0],
  reply: Parameters<typeof sendPublicError>[1],
  error: ProductAdminError,
) {
  if (error.code === 'PRODUCT_NOT_FOUND')
    return sendPublicError(request, reply, 404, 'PRODUCT_NOT_FOUND');
  if (error.code === 'DUPLICATE_SLUG')
    return sendPublicError(request, reply, 409, 'DUPLICATE_SLUG');
  if (error.code === 'INVALID_MIXING_GROUP')
    return sendPublicError(request, reply, 400, 'INVALID_MIXING_GROUP');
  return sendPublicError(request, reply, 400, 'INVALID_INPUT');
}
export default function adminProductsRoutes(
  app: FastifyInstance,
  { services }: { services: AdminProductsRouteServices },
): void {
  app.addHook('preValidation', requireAdmin(services.sessions));
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();
  typed.get(
    '/api/admin/products',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        querystring: AdminProductListQuery,
        response: {
          200: AdminProductWithCountryListResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    (request) => ({
      items: services.productAdmin
        .listAdmin(request.query, request.resolvedCountry)
        .map(mapWithCountry),
    }),
  );
  typed.get(
    '/api/admin/products/:productId',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        params: AdminProductIdParam,
        response: {
          200: AdminProductWithCountry,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    (request, reply) => {
      const product = services.productAdmin.getAdmin(
        Number(request.params.productId),
        request.resolvedCountry,
      );
      if (!product) return sendPublicError(request, reply, 404, 'PRODUCT_NOT_FOUND');
      return mapWithCountry(product);
    },
  );
  typed.post(
    '/api/admin/products',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        body: CreateAdminProductBody,
        response: {
          201: AdminProduct,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    (request, reply) => {
      try {
        reply.code(201);
        return map(
          services.productAdmin.create(
            request.body,
            context(request.authenticatedUser!.id, request.id, request.resolvedCountry),
          ),
        );
      } catch (e) {
        if (e instanceof ProductAdminError) return sendError(request, reply, e);
        throw e;
      }
    },
  );
  typed.patch(
    '/api/admin/products/:productId',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        params: AdminProductIdParam,
        body: UpdateAdminProductBody,
        response: {
          200: AdminProduct,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    (request, reply) => {
      try {
        return map(
          services.productAdmin.update(
            Number(request.params.productId),
            request.body,
            context(request.authenticatedUser!.id, request.id, request.resolvedCountry),
          ),
        );
      } catch (e) {
        if (e instanceof ProductAdminError) return sendError(request, reply, e);
        throw e;
      }
    },
  );
  typed.delete(
    '/api/admin/products/:productId',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        params: AdminProductIdParam,
        response: { 200: AdminProduct, 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse },
      },
    },
    (request, reply) => {
      try {
        return map(
          services.productAdmin.retire(
            Number(request.params.productId),
            context(request.authenticatedUser!.id, request.id, request.resolvedCountry),
          ),
        );
      } catch (e) {
        if (e instanceof ProductAdminError) return sendError(request, reply, e);
        throw e;
      }
    },
  );
}
