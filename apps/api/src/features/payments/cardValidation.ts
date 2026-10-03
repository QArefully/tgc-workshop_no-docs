export interface ValidCard {
  digits: string;
  brand: string;
  last4: string;
}

function luhnCheck(digits: string): boolean {
  let sum = 0;
  let alternate = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = Number(digits[index]);
    if (alternate) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

function detectBrand(digits: string): string {
  if (digits.startsWith('4')) return 'Visa';
  if (/^5[1-5]/.test(digits) || /^2(2[2-9]|[3-6]\d|7[01])/.test(digits)) return 'Mastercard';
  return 'Unknown';
}

export function validateCard(input: {
  cardNumber: string;
  cardExpiry: string;
  cardCvc: string;
  now: Date;
}): ValidCard | undefined {
  const digits = input.cardNumber.replace(/\D/g, '');
  if (digits.length < 12 || digits.length > 19 || !luhnCheck(digits)) return undefined;

  const expiry = input.cardExpiry.trim().match(/^(\d{2})\/(\d{2})$/);
  if (!expiry) return undefined;
  const month = Number(expiry[1]);
  const year = Number(expiry[2]);
  const { now } = input;
  if (
    month < 1 ||
    month > 12 ||
    year < now.getFullYear() % 100 ||
    (year === now.getFullYear() % 100 && month < now.getMonth() + 1) ||
    !/^\d{3,4}$/.test(input.cardCvc.trim())
  ) {
    return undefined;
  }

  return { digits, brand: detectBrand(digits), last4: digits.slice(-4) };
}
