import mongoose from "mongoose";
import { logger } from "../utils/logger.js";
import { env } from "./env.js";
async function connectDatabase() {
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.MONGODB_URI);
  logger.info("MongoDB connected");
}
export {
  connectDatabase
};
