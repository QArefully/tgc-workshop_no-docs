/** Deterministic simulated refund gateway. No external calls, no card data. */
export interface RefundGateway {
  refund(idempotencyKey: string): { simulatedReference: string; processor: string };
}

export function createRefundGateway(): RefundGateway {
  return {
    refund(idempotencyKey) {
      return {
        simulatedReference: `sim_refund_${idempotencyKey}`,
        processor: 'simulated',
      };
    },
  };
}
