export const FAULT_KEYS = Object.freeze([
  'async.job_handler_failure',
  'async.notification_delivery_failure',
  'async.webhook_processing_failure',
  'async.standing_order_run_failure',
  'async.back_in_stock_failure',
] as const);
export type FaultKey = (typeof FAULT_KEYS)[number];
export interface FaultSwitch {
  isEnabled(key: FaultKey): boolean;
}
export const noFaults: FaultSwitch = Object.freeze({ isEnabled: () => false });
