const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return email.length >= 3 && email.length <= 254 && EMAIL_PATTERN.test(email);
}

export function normalizeDisplayName(displayName: string): string {
  return displayName.trim();
}

export function isValidDisplayName(displayName: string): boolean {
  return displayName.length >= 1 && displayName.length <= 80;
}

export function isValidPassword(password: string): boolean {
  return password.length >= 8 && password.length <= 128;
}
