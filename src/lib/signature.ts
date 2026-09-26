import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'x-signature';
const PREFIX = 'sha256=';

/** HMAC-SHA256 over the exact raw request body, hex encoded, sent as `sha256=<hex>`. */
export function signPayload(rawBody: string | Buffer, secret: string): string {
  return PREFIX + createHmac('sha256', secret).update(rawBody).digest('hex');
}

/** Constant-time comparison; accepts the header with or without the `sha256=` prefix. */
export function verifySignature(
  rawBody: Buffer | undefined,
  header: string | undefined,
  secret: string,
): boolean {
  if (!rawBody || !header) return false;
  const provided = header.startsWith(PREFIX) ? header.slice(PREFIX.length) : header;
  if (!/^[0-9a-f]{64}$/i.test(provided)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  return timingSafeEqual(Buffer.from(provided, 'hex'), expected);
}
