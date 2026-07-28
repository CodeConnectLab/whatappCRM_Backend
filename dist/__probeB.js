import { Schema } from "mongoose";
import { getModel } from "./utils/registerModel.js";
const s = new Schema({
  name: { type: String, required: true },
  body: { type: String, required: true }
});
const ProbeBModel = getModel("ProbeB", s);
export {
  ProbeBModel
};
