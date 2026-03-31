/**
 * Converts a 10-digit Philippine number (9XXXXXXXXX) to E.164 format (+63XXXXXXXXXX).
 */
export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return `+63${digits}`;
}

/**
 * Converts a +63XXXXXXXXXX number to the fake email used for Supabase Auth.
 * Strips the leading '+' so the local part is numeric-only.
 * e.g. +639171234567 → 639171234567@lpggo.app
 */
export function formatPhoneAsEmail(phone: string): string {
  const digits = phone.replace(/^\+/, '');
  return `${digits}@lpggo.app`;
}
