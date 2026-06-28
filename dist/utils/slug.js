import { randomBytes } from "crypto";
function slugify(input) {
  const base = input.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const suffix = randomBytes(3).toString("hex");
  return `${base || "company"}-${suffix}`;
}
export {
  slugify
};
