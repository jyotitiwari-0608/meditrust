import mongoose from 'mongoose';

const { Schema } = mongoose;

const drugSchema = new Schema(
  {
    salt: { type: String, required: true, trim: true },
    strength: { type: String, required: true, trim: true },
    form: { type: String, required: true, trim: true },
    atcCode: { type: String, required: true, trim: true, uppercase: true },
  },
  { timestamps: true }
);

drugSchema.index(
  { salt: 'text', atcCode: 'text' },
  { weights: { salt: 10, atcCode: 5 }, name: 'drug_text_search' }
);
drugSchema.index({ salt: 1, strength: 1, form: 1 });
drugSchema.index({ atcCode: 1 });

export const Drug = mongoose.model('Drug', drugSchema);
export default Drug;
