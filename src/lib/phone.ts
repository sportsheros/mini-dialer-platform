/** E.164: '+', country code not starting with 0, max 15 digits total. */
const E164 = /^\+[1-9]\d{6,14}$/;

export function isE164(phone: string): boolean {
  return E164.test(phone);
}

/**
 * Lenient normalisation of what humans paste from spreadsheets: strips spaces, dashes, dots
 * and parentheses, and turns an international "00" prefix into "+". It does NOT guess country
 * codes; anything still not E.164 afterwards is reported as invalid.
 */
export function normalizePhone(raw: string): string {
  let phone = raw.trim().replace(/[\s\-().]/g, '');
  if (phone.startsWith('00')) phone = `+${phone.slice(2)}`;
  return phone;
}
