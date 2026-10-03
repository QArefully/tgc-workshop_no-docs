export const AUTHORITATIVE_CURRENCY = 'GBP' as const;

export interface PaymentGatewayRequest {
  idempotencyKey: string;
  amountCents: number;
  currency: typeof AUTHORITATIVE_CURRENCY;
  cardNumber: string;
}

export type GatewayResult =
  | { status: 'success'; reference: string }
  | { status: 'declined'; reason: string }
  | { status: 'timeout' };

export interface PaymentGateway {
  process(request: PaymentGatewayRequest): Promise<GatewayResult>;
}

const DECLINE_CARD = '4000000000000002';
const TIMEOUT_CARD = '4000000000000069';

export const simulatedPaymentGateway: PaymentGateway = {
  async process(request) {
    if (request.cardNumber === DECLINE_CARD) return { status: 'declined', reason: 'CARD_DECLINED' };
    if (request.cardNumber === TIMEOUT_CARD) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return { status: 'timeout' };
    }
    return { status: 'success', reference: `sim_${request.idempotencyKey}` };
  },
};
