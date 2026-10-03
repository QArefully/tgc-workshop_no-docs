import { apiFetch } from './client';
import {
  UpdatePreferencesBody,
  UserPreferences,
  type UpdatePreferencesBody as UpdatePreferencesPayload,
} from '@shop/contracts/account-depth';

const PREFERENCES_PATH = '/api/account/preferences';

export function getAccountPreferences(): Promise<UserPreferences> {
  return apiFetch(UserPreferences, PREFERENCES_PATH);
}

export function updateAccountPreferences(body: UpdatePreferencesPayload): Promise<UserPreferences> {
  return apiFetch(UserPreferences, PREFERENCES_PATH, {
    method: 'PATCH',
    body: JSON.stringify(body satisfies UpdatePreferencesBody),
  });
}
