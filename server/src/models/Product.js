import mongoose from 'mongoose';
import { provenanceSchema } from './provenance.js';

const { Schema } = mongoose;

const productSchema = new Schema(
  {
    drug: { type: Schema.Types.ObjectId, ref: 'Drug', required: true },
    manufacturer: {
      type: Schema.Types.ObjectId,
      ref: 'Manufacturer',
      required: true,
    },
    brand: { type: Schema.Types.ObjectId, ref: 'Brand' },
    mrp: { type: Number, required: true, min: 0 },
    teCode: { type: String, trim: true, uppercase: true },
    source: { type: provenanceSchema, required: true },
  },
  { timestamps: true }
);

productSchema.index({ drug: 1, mrp: 1 });
productSchema.index({ manufacturer: 1 });
productSchema.index({ brand: 1 });
productSchema.index({ teCode: 1 });

export const Product = mongoose.model('Product', productSchema);
export default Product;
