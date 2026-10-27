import mongoose from 'mongoose';

const { Schema } = mongoose;

const auditSchema = new Schema(
  {
    action: {
      type: String,
      required: true,
      enum: ['SUBSTITUTION_CONFIRMED'],
      default: 'SUBSTITUTION_CONFIRMED',
    },
    fromProduct: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    toProduct: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    risks: { type: [String], default: [] },
    note: { type: String, trim: true },
    confirmed: { type: Boolean, required: true, validate: (value) => value === true },
    confirmedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

auditSchema.index({ createdAt: -1 });
auditSchema.index({ fromProduct: 1, toProduct: 1 });

export const Audit = mongoose.model('Audit', auditSchema);
export default Audit;
