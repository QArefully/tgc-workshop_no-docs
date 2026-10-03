import { Type } from '@sinclair/typebox';
import {
  AdminVariant,
  type CreateAdminVariantBody,
  type SetAdminVariantClearanceBody,
  type UpdateAdminVariantBody,
} from '@shop/contracts/admin-variants';
import { apiFetch } from './client';

// The country-aware lot listing is an admin-only route response. Keep the
// extension local rather than widening the shared variant contract, and keep
// additional-property rejection enabled at the browser boundary.
const AdminVariantWithCountry = Type.Object(
  { ...AdminVariant.properties, blockedInCountry: Type.Boolean() },
  { additionalProperties: false },
);
const AdminVariantWithCountryListResponse = Type.Object(
  { items: Type.Array(AdminVariantWithCountry) },
  { additionalProperties: false },
);

export const getAdminProductVariants = (productId: string) =>
  apiFetch(AdminVariantWithCountryListResponse, `/api/admin/products/${productId}/variants`);
export const createAdminVariant = (body: CreateAdminVariantBody) =>
  apiFetch(AdminVariant, '/api/admin/variants', {
    method: 'POST',
    body: JSON.stringify(body satisfies CreateAdminVariantBody),
  });
export const updateAdminVariant = (variantId: string, body: UpdateAdminVariantBody) =>
  apiFetch(AdminVariant, `/api/admin/variants/${variantId}`, {
    method: 'PATCH',
    body: JSON.stringify(body satisfies UpdateAdminVariantBody),
  });
export const retireAdminVariant = (variantId: string) =>
  apiFetch(AdminVariant, `/api/admin/variants/${variantId}`, { method: 'DELETE' });
export const setAdminVariantClearance = (variantId: string, body: SetAdminVariantClearanceBody) =>
  apiFetch(AdminVariant, `/api/admin/variants/${variantId}/clearance`, {
    method: 'PUT',
    body: JSON.stringify(body satisfies SetAdminVariantClearanceBody),
  });
