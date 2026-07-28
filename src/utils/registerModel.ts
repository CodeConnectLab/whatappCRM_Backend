import mongoose, { type Schema, type Model } from 'mongoose';

/**
 * Avoid OverwriteModelError when `tsx watch` re-executes model files.
 *
 * The schema is widened to `never` at the call: resolving mongoose's generic
 * `model<T>()` overload against a bare `Schema` sends tsc into pathological type
 * instantiation — one model file alone was enough to exhaust a 3 GB heap, so
 * `npm run typecheck` could never finish. Runtime behaviour is unchanged.
 */
export function getModel<T>(name: string, schema: Schema): Model<T> {
  const existing = mongoose.models[name];
  if (existing) {
    return existing as unknown as Model<T>;
  }
  return mongoose.model(name, schema as never) as unknown as Model<T>;
}
