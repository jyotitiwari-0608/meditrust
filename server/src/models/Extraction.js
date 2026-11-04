import mongoose from 'mongoose';

const { Schema } = mongoose;

export function lowConfidenceThreshold() {
  const parsed = Number.parseFloat(process.env.LOW_CONFIDENCE_THRESHOLD);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.6;
}

const extractionSchema = new Schema(
  {
    signal: { type: Schema.Types.ObjectId, ref: 'Signal', required: true },
    json: { type: Schema.Types.Mixed, required: true },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    needsReview: { type: Boolean, default: false },
  },
  { timestamps: true }
);

extractionSchema.pre('validate', function flagLowConfidence(next) {
  if (
    typeof this.confidence === 'number' &&
    this.confidence < lowConfidenceThreshold()
  ) {
    this.needsReview = true;
  }
  next();
});

extractionSchema.index({ signal: 1 });
extractionSchema.index({ needsReview: 1, confidence: 1 });

export const Extraction = mongoose.model('Extraction', extractionSchema);
export default Extraction;
