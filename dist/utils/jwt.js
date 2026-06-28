import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
function signAccessToken(payload) {
  const body = { ...payload, typ: "access" };
  return jwt.sign(body, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES
  });
}
function signRefreshToken(payload) {
  const body = { ...payload, typ: "refresh" };
  return jwt.sign(body, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES
  });
}
function verifyAccessToken(token) {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
  if (typeof decoded === "string" || decoded.typ !== "access") {
    throw new Error("Invalid access token");
  }
  return decoded;
}
function verifyRefreshToken(token) {
  const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET);
  if (typeof decoded === "string" || decoded.typ !== "refresh") {
    throw new Error("Invalid refresh token");
  }
  return decoded;
}
export {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken
};
