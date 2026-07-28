// Probe: getModel<T>/model<T> with an untyped Schema, no InferSchemaType.
import { Schema } from 'mongoose';
import { getModel } from './utils/registerModel.js';

type Doc = { name: string; body: string };

const s = new Schema({
  name: { type: String, required: true },
  body: { type: String, required: true },
});

export const ProbeBModel = getModel<Doc>('ProbeB', s);
