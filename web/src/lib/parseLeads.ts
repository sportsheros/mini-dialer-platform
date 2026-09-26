export interface LeadInput {
  phone: string;
  name?: string;
}

/**
 * Accepts either a JSON array (`[{ "phone": "+1...", "name": "..." }]`) or CSV with
 * `phone,name` columns (header row optional). Phone validation is left to the backend, which
 * reports invalid numbers in its counts.
 */
export function parseLeads(text: string): LeadInput[] {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Paste some leads first.');

  if (trimmed.startsWith('[')) {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error('JSON must be an array of { phone, name? }.');
    return parsed.map((row, i) => {
      if (typeof row !== 'object' || row === null || typeof (row as LeadInput).phone !== 'string') {
        throw new Error(`Row ${i + 1}: expected an object with a "phone" string.`);
      }
      const { phone, name } = row as LeadInput;
      return name ? { phone, name } : { phone };
    });
  }

  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim());
  const [first] = lines;
  const hasHeader = /phone/i.test(first) && !/\d{5,}/.test(first);
  return (hasHeader ? lines.slice(1) : lines).map((line) => {
    const [phone, ...rest] = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const name = rest.join(',').trim();
    return name ? { phone, name } : { phone };
  });
}
