/**
 * Bridges the app's named placeholders ({{name}}, {{phone}}, {{email}}) and the
 * positional ones Meta requires ({{1}}, {{2}}, ...).
 */

/** Contact fields usable as template placeholders. */
export const TEMPLATE_VARIABLES = ['name', 'phone', 'email'] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

const PLACEHOLDER_RE = /\{\{\s*([a-z_]+)\s*\}\}/gi;

/** Named placeholders in order of first appearance; unknown names are ignored. */
export function extractVariables(body: string): TemplateVariable[] {
  const seen: TemplateVariable[] = [];
  for (const match of body.matchAll(PLACEHOLDER_RE)) {
    const key = match[1]!.toLowerCase() as TemplateVariable;
    if (TEMPLATE_VARIABLES.includes(key) && !seen.includes(key)) seen.push(key);
  }
  return seen;
}

/** Rewrites {{name}} → {{1}} etc. using the order in `variables`. */
export function toPositionalBody(body: string, variables: TemplateVariable[]): string {
  let out = body;
  variables.forEach((key, i) => {
    out = out.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi'), `{{${i + 1}}}`);
  });
  return out;
}

/**
 * Meta template names must be lowercase alphanumeric + underscores.
 * "Order Update!" → "order_update"
 */
export function toMetaTemplateName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 512);
  return slug || 'template';
}

/** Values for {{1}}, {{2}}, ... in `variables` order. Empty fields fall back to '-' (Meta rejects blanks). */
export function buildParameterValues(
  variables: TemplateVariable[],
  contact: { name?: string | null; phone?: string | null; email?: string | null },
): string[] {
  return variables.map((key) => contact[key]?.trim() || '-');
}
