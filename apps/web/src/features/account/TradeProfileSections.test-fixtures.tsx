import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect } from 'vitest';
import type { BillingEntity, DeliverySite } from '@shop/contracts/trade-account';
import type { PostalAddress } from '@shop/contracts/address';
import { listDeliverySites } from '@/api/tradeAccount';
import { DeliverySitesSection } from './DeliverySitesSection';
import { BillingEntitiesSection } from './BillingEntitiesSection';
import { useTradeProfile } from './useTradeProfile';
export const ADDRESS: PostalAddress = {
  line1: '1 Mill Road',
  city: 'Leeds',
  postcode: 'LS1 4AB',
  countryCode: 'GB',
};

export const TIMESTAMP = '2026-07-01T00:00:00.000Z';

export function site(overrides: Partial<DeliverySite> = {}): DeliverySite {
  return {
    id: '1',
    label: 'Main yard',
    contactName: 'Dana Reed',
    contactPhone: '01133 445566',
    address: ADDRESS,
    isDefault: true,
    active: true,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  };
}

export function entity(overrides: Partial<BillingEntity> = {}): BillingEntity {
  return {
    id: '1',
    legalName: 'Northgate Builders Ltd',
    registrationNumber: '09123456',
    vatNumber: 'GB123456789',
    address: ADDRESS,
    isDefault: true,
    active: true,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  };
}

export const SECOND_SITE = site({ id: '2', label: 'North depot', isDefault: false });
export const SECOND_ENTITY = entity({
  id: '2',
  legalName: 'Southbank Trading Ltd',
  isDefault: false,
});

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Renders both sections against one shared `useTradeProfile` instance, as `AccountPage` does. */
export function TradeProfileHarness() {
  const profile = useTradeProfile();
  return (
    <>
      <DeliverySitesSection profile={profile} />
      <BillingEntitiesSection profile={profile} />
    </>
  );
}

export function deliverySection(): HTMLElement {
  return screen.getByRole('region', { name: 'Delivery sites' });
}

export function billingSection(): HTMLElement {
  return screen.getByRole('region', { name: 'Billing details' });
}

export async function renderHarness() {
  render(<TradeProfileHarness />);
  await waitFor(() => expect(listDeliverySites).toHaveBeenCalled());
}

function setInputValue(scope: HTMLElement, label: string, value: string) {
  fireEvent.change(within(scope).getByLabelText(label), { target: { value } });
}

export async function fillAddress(
  user: ReturnType<typeof userEvent.setup>,
  scope: HTMLElement,
  options: { keyboard?: boolean } = {},
) {
  if (options.keyboard) {
    await user.type(within(scope).getByLabelText('Address line 1'), '2 Kiln Lane');
    await user.type(within(scope).getByLabelText('City'), 'Leeds');
    await user.type(within(scope).getByLabelText('Postcode'), 'LS9 8QQ');
  } else {
    setInputValue(scope, 'Address line 1', '2 Kiln Lane');
    setInputValue(scope, 'City', 'Leeds');
    setInputValue(scope, 'Postcode', 'LS9 8QQ');
  }
}
