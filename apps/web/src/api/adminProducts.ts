import { Type } from '@sinclair/typebox';
import {
  AdminProduct,
  type AdminProductListQuery,
  type CreateAdminProductBody,
  type UpdateAdminProductBody,
} from '@shop/contracts/admin-products';
import { apiFetch } from './client';

// Admin catalog reads are annotated by the standing country at the route
// boundary. Keep this schema local so the shared product contract remains
// reusable for non-admin responses while strict validation still rejects any
// unrelated fields.
const AdminProductWithCountry = Type.Object(
  { ...AdminProduct.properties, blockedInCountry: Type.Boolean() },
  { additionalProperties: false },
);
const AdminProductWithCountryListResponse = Type.Object(
  { items: Type.Array(AdminProductWithCountry) },
  { additionalProperties: false },
);

export function getAdminProducts(query: AdminProductListQuery = {}) {
  const params = new URLSearchParams();
  if (query.includeRetired !== undefined)
    params.set('includeRetired', String(query.includeRetired));
  const suffix = params.size ? `?${params}` : '';
  return apiFetch(AdminProductWithCountryListResponse, `/api/admin/products${suffix}`);
}
export const getAdminProduct = (productId: string) =>
  apiFetch(AdminProductWithCountry, `/api/admin/products/${productId}`);
export const createAdminProduct = (body: CreateAdminProductBody) =>
  apiFetch(AdminProduct, '/api/admin/products', {
    method: 'POST',
    body: JSON.stringify(body satisfies CreateAdminProductBody),
  });
export const updateAdminProduct = (productId: string, body: UpdateAdminProductBody) =>
  apiFetch(AdminProduct, `/api/admin/products/${productId}`, {
    method: 'PATCH',
    body: JSON.stringify(body satisfies UpdateAdminProductBody),
  });
export const retireAdminProduct = (productId: string) =>
  apiFetch(AdminProduct, `/api/admin/products/${productId}`, { method: 'DELETE' });
