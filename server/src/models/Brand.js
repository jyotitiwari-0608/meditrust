import mongoose from 'mongoose';
import { provenanceSchema } from './provenance.js';

const { Schema } = mongoose;

const brandSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    manufacturer: { type: Schema.Types.ObjectId, ref: 'Manufacturer' },
    drug: { type: Schema.Types.ObjectId, ref: 'Drug' },
    source: { type: provenanceSchema, required: true },
  },
  { timestamps: true }
);

brandSchema.index({ name: 'text' }, { name: 'brand_text_search' });
brandSchema.index({ manufacturer: 1 });
brandSchema.index({ drug: 1 });

export const Brand = mongoose.model('Brand', brandSchema);
export default Brand;
