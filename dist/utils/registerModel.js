import mongoose, { model } from "mongoose";
function getModel(name, schema) {
  const existing = mongoose.models[name];
  if (existing) {
    return existing;
  }
  return model(name, schema);
}
export {
  getModel
};
