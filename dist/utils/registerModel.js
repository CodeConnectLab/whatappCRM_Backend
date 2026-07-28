import mongoose from 'mongoose';
/**
 * Avoid OverwriteModelError when `tsx watch` re-executes model files.
 *
 * The schema is widened to `never` at the call: resolving mongoose's generic
 * `model<T>()` overload against a bare `Schema` sends tsc into pathological type
 * instantiation — one model file alone was enough to exhaust a 3 GB heap, so
 * `npm run typecheck` could never finish. Runtime behaviour is unchanged.
 */
export function getModel(name, schema) {
    const existing = mongoose.models[name];
    if (existing) {
        return existing;
    }
    return mongoose.model(name, schema);
}
