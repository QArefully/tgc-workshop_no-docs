import { useCallback, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/** Ordered checkout steps. A step is reachable only once every earlier step validates. */
export type CheckoutStep = 'delivery' | 'schedule' | 'payment';

const STEP_URL: Record<CheckoutStep, string> = {
  delivery: '/checkout',
  schedule: '/checkout?step=schedule',
  payment: '/checkout?step=payment',
};

/**
 * Derives the active step from `?step=` and sends the buyer back when a deep link points past a
 * step that still needs input. Checkout inputs are deliberately not persisted, so a refreshed or
 * shared later-step URL always lands on the first incomplete step.
 */
export function useCheckoutNavigation(deliveryIsValid: boolean, scheduleIsValid: boolean) {
  const navigate = useNavigate();
  const location = useLocation();
  const rawStep = new URLSearchParams(location.search).get('step');
  const stepIsKnown = rawStep === null || rawStep === 'schedule' || rawStep === 'payment';
  const requestedStep: CheckoutStep =
    rawStep === 'schedule' ? 'schedule' : rawStep === 'payment' ? 'payment' : 'delivery';

  const step: CheckoutStep = !stepIsKnown
    ? 'delivery'
    : !deliveryIsValid
      ? 'delivery'
      : requestedStep === 'payment' && !scheduleIsValid
        ? 'schedule'
        : requestedStep;

  useEffect(() => {
    if (step !== requestedStep || !stepIsKnown) navigate(STEP_URL[step], { replace: true });
  }, [navigate, requestedStep, step, stepIsKnown]);

  return {
    step,
    goToDelivery: useCallback(() => navigate(STEP_URL.delivery), [navigate]),
    goToSchedule: useCallback(() => navigate(STEP_URL.schedule), [navigate]),
    goToPayment: useCallback(() => navigate(STEP_URL.payment), [navigate]),
    replaceWithOrder: useCallback(
      (orderId: string) => navigate(`/order-confirmation/${orderId}`, { replace: true }),
      [navigate],
    ),
  };
}
