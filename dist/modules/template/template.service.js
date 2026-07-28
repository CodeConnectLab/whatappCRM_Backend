const TEMPLATE_VARIABLES = ["name", "phone", "email"];
const PLACEHOLDER_RE = /\{\{\s*([a-z_]+)\s*\}\}/gi;
function extractVariables(body) {
  const seen = [];
  for (const match of body.matchAll(PLACEHOLDER_RE)) {
    const key = match[1].toLowerCase();
    if (TEMPLATE_VARIABLES.includes(key) && !seen.includes(key)) seen.push(key);
  }
  return seen;
}
function toPositionalBody(body, variables) {
  let out = body;
  variables.forEach((key, i) => {
    out = out.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "gi"), `{{${i + 1}}}`);
  });
  return out;
}
function toMetaTemplateName(name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 512);
  return slug || "template";
}
function buildParameterValues(variables, contact) {
  return variables.map((key) => contact[key]?.trim() || "-");
}
export {
  TEMPLATE_VARIABLES,
  buildParameterValues,
  extractVariables,
  toMetaTemplateName,
  toPositionalBody
};
