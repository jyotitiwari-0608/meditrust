import mongoose from 'mongoose';

const { Schema } = mongoose;

export const SIGNAL_TYPES = ['NSQ', 'RECALL', 'INSPECTION', 'APPROVAL'];
export const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const signalSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product' },
    manufacturer: { type: Schema.Types.ObjectId, ref: 'Manufacturer' },
    type: { type: String, required: true, enum: SIGNAL_TYPES },
    date: { type: Date, required: true },
    severity: { type: String, enum: SEVERITIES, default: 'MEDIUM' },
    sourceName: { type: String, required: true, trim: true },
    sourceUrl: { type: String, required: true, trim: true },
    rawText: { type: String, trim: true },
    externalId: { type: String, trim: true },
    needsReview: { type: Boolean, default: false },
    reviewReason: { type: String, trim: true },
  },
  { timestamps: true }
);

signalSchema.pre('validate', function ensureSubject(next) {
  if (!this.product && !this.manufacturer) {
    this.invalidate(
      'product',
      'A signal must reference a product or a manufacturer.'
    );
  }
  next();
});

signalSchema.index({ manufacturer: 1, date: -1 });
signalSchema.index({ product: 1, date: -1 });
signalSchema.index({ type: 1, severity: 1 });
signalSchema.index({ externalId: 1 }, { unique: true, sparse: true });
signalSchema.index({ needsReview: 1 });
signalSchema.index(
  { rawText: 'text', sourceName: 'text' },
  { weights: { rawText: 5, sourceName: 1 }, name: 'signal_text_search' }
);

export const Signal = mongoose.model('Signal', signalSchema);
export default Signal;
