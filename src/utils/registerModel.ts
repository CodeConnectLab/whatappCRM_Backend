import mongoose, { type Schema, model, type Model } from 'mongoose';

/** Avoid OverwriteModelError when `tsx watch` re-executes model files. */
export function getModel<T>(name: string, schema: Schema): Model<T> {
  const existing = mongoose.models[name];
  if (existing) {
    return existing as Model<T>;
  }
  return model<T>(name, schema);
}
