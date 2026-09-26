import { isE164, normalizePhone } from '../../lib/phone';
import type { UploadLeadsInput } from './leads.schema';

export interface LeadCandidate {
  phone: string;
  name: string | null;
}

/** Pure step: normalise, drop invalid numbers, dedupe within the payload (first one wins). */
export function prepareLeads(rows: UploadLeadsInput): {
  candidates: LeadCandidate[];
  invalid: number;
  duplicates: number;
} {
  const seen = new Map<string, LeadCandidate>();
  let invalid = 0;
  let duplicates = 0;
  for (const row of rows) {
    const phone = normalizePhone(row.phone);
    if (!isE164(phone)) {
      invalid++;
    } else if (seen.has(phone)) {
      duplicates++;
    } else {
      seen.set(phone, { phone, name: row.name || null });
    }
  }
  return { candidates: [...seen.values()], invalid, duplicates };
}
