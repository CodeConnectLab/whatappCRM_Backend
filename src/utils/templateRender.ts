/** Replace {{ name }}, {{phone}} etc. with contact fields (case-insensitive keys). */
export function applyTemplate(
  body: string,
  contact: { name?: string | null; phone?: string | null; email?: string | null },
): string {
  const vars: Record<string, string> = {
    name: contact.name?.trim() || '',
    phone: contact.phone?.trim() || '',
    email: contact.email?.trim() || '',
  };
  let out = body;
  for (const [key, val] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}}`, 'gi'), val);
  }
  return out;
}
