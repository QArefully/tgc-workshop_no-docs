/** Frontend promo eligibility gate. Backend re-validates authoritatively. */
export function isEligibleForPromo(totalItems: number): boolean {
  return totalItems >= 5;
}
