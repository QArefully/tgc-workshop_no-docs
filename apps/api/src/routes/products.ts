import { FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { sendPublicError } from '../utils/errors.js';
import { toProductContract, toProductWithVariantsContract } from '../mappers/product.js';
import {
  ProductComparisonQuery,
  ProductComparisonResponse,
  ProductIdParam,
  CategoriesResponse,
  BestsellersResponse,
  RelatedResponse,
  SimilarProductsResponse,
  ProductListPaginatedResponse,
  ProductFilterOptionsResponse,
  ProductQuery,
  ProductWithVariants,
} from '@shop/contracts/products';
import { ErrorResponse } from '@shop/contracts/common';
import type { AppContext } from '../app.js';
import { CatalogQueryError } from '../features/catalog/catalogQuery.js';
import { ComparisonSelectionError } from '../features/catalog/productComparison.js';

export default function productsRoutes(app: FastifyInstance, { services }: AppContext): void {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();
  const { products, clock } = services;

  typed.get(
    '/api/products/filter-options',
    {
      schema: {
        response: {
          200: ProductFilterOptionsResponse,
        },
      },
    },
    (request) => products.listFilterOptions(request.resolvedCountry),
  );

  typed.get(
    '/api/products/categories',
    {
      schema: {
        response: {
          200: CategoriesResponse,
        },
      },
    },
    (request) => {
      return products.listCategories(request.resolvedCountry);
    },
  );

  typed.get(
    '/api/products/bestsellers',
    {
      schema: {
        response: {
          200: BestsellersResponse,
        },
      },
    },
    (request) => {
      return products.listBestsellers(request.resolvedCountry).map(toProductContract);
    },
  );

  typed.get(
    '/api/products',
    {
      schema: {
        querystring: ProductQuery,
        response: {
          200: ProductListPaginatedResponse,
          400: ErrorResponse,
        },
      },
    },
    (request, reply) => {
      try {
        const result = products.list(request.query, request.resolvedCountry);
        return {
          items: result.items.map(toProductContract),
          total: result.total,
          page: result.page,
          pageSize: result.pageSize,
        };
      } catch (error) {
        if (error instanceof CatalogQueryError) {
          sendPublicError(request, reply, 400, 'INVALID_QUERY');
          return;
        }
        throw error;
      }
    },
  );

  typed.get(
    '/api/products/compare',
    {
      schema: {
        querystring: ProductComparisonQuery,
        response: {
          200: ProductComparisonResponse,
          400: ErrorResponse,
        },
      },
    },
    (request, reply) => {
      try {
        return products.compare(request.query.ids, request.resolvedCountry);
      } catch (error) {
        if (error instanceof ComparisonSelectionError) {
          sendPublicError(request, reply, 400, 'INVALID_QUERY');
          return;
        }
        throw error;
      }
    },
  );

  typed.get(
    '/api/products/:id',
    {
      schema: {
        params: ProductIdParam,
        response: {
          200: ProductWithVariants,
          400: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const rawId = request.params.id;
      const productId = Number(rawId);

      if (!Number.isFinite(productId) || productId <= 0 || !Number.isInteger(productId)) {
        sendPublicError(request, reply, 400, 'REQUEST_INVALID');
        return;
      }

      const product = products.findCustomerProductById(productId, request.resolvedCountry);
      if (!product) {
        sendPublicError(request, reply, 404, 'PRODUCT_NOT_FOUND');
        return;
      }
      const variants = products.listVariants(productId, request.resolvedCountry);
      return toProductWithVariantsContract(product, variants, clock.now());
    },
  );

  typed.get(
    '/api/products/:id/similar',
    {
      schema: {
        params: ProductIdParam,
        response: {
          200: SimilarProductsResponse,
          400: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const productId = Number(request.params.id);
      if (!Number.isFinite(productId) || productId <= 0 || !Number.isInteger(productId)) {
        sendPublicError(request, reply, 400, 'REQUEST_INVALID');
        return;
      }

      const similar = products.listSimilar(productId, request.resolvedCountry);
      if (!similar) {
        sendPublicError(request, reply, 404, 'PRODUCT_NOT_FOUND');
        return;
      }
      return similar.map(toProductContract);
    },
  );

  typed.get(
    '/api/products/:id/related',
    {
      schema: {
        params: ProductIdParam,
        response: {
          200: RelatedResponse,
          400: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const rawId = request.params.id;
      const productId = Number(rawId);

      if (!Number.isFinite(productId) || productId <= 0 || !Number.isInteger(productId)) {
        sendPublicError(request, reply, 400, 'REQUEST_INVALID');
        return;
      }

      const similar = products.listRelated(productId, request.resolvedCountry);
      if (!similar) {
        sendPublicError(request, reply, 404, 'PRODUCT_NOT_FOUND');
        return;
      }
      return similar.map(toProductContract);
    },
  );
}
