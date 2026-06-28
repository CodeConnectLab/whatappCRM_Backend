import { getMeProfile } from "./user.service.js";
async function me(req, res) {
  const data = await getMeProfile(req.user.sub);
  if (!data) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(data);
}
export {
  me
};
