/**
 * Bridges the app's named placeholders ({{name}}, {{phone}}, {{email}}) and the
 * positional ones Meta requires ({{1}}, {{2}}, ...).
 */
/** Contact fields usable as template placeholders. */
export const TEMPLATE_VARIABLES = ['name', 'phone', 'email'];
const PLACEHOLDER_RE = /\{\{\s*([a-z_]+)\s*\}\}/gi;
/** Named placeholders in order of first appearance; unknown names are ignored. */
export function extractVariables(body) {
    const seen = [];
    for (const match of body.matchAll(PLACEHOLDER_RE)) {
        const key = match[1].toLowerCase();
        if (TEMPLATE_VARIABLES.includes(key) && !seen.includes(key))
            seen.push(key);
    }
    return seen;
}
/** Rewrites {{name}} → {{1}} etc. using the order in `variables`. */
export function toPositionalBody(body, variables) {
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
export function toMetaTemplateName(name) {
    const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 512);
    return slug || 'template';
}
/** Values for {{1}}, {{2}}, ... in `variables` order. Empty fields fall back to '-' (Meta rejects blanks). */
export function buildParameterValues(variables, contact) {
    return variables.map((key) => contact[key]?.trim() || '-');
}
