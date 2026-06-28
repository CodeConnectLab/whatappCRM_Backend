function applyTemplate(body, contact) {
  const vars = {
    name: contact.name?.trim() || "",
    phone: contact.phone?.trim() || "",
    email: contact.email?.trim() || ""
  };
  let out = body;
  for (const [key, val] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}}`, "gi"), val);
  }
  return out;
}
export {
  applyTemplate
};
