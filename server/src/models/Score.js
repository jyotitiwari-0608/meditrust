import mongoose from 'mongoose';
import { provenanceSchema } from './provenance.js';

const { Schema } = mongoose;

const factorSchema = new Schema(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    weight: { type: Number, required: true, min: 0, max: 1 },
    value: { type: Number, required: true, min: 0, max: 100 },
    contribution: { type: Number, required: true },
    source: { type: provenanceSchema, required: true },
    evidence: [{ type: Schema.Types.ObjectId, ref: 'Signal' }],
  },
  { _id: false }
);

const scoreSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    value: { type: Number, required: true, min: 0, max: 100 },
    band: {
      type: String,
      required: true,
      enum: ['High', 'Moderate', 'Low', 'LimitedData'],
    },
    factors: {
      type: [factorSchema],
      required: true,
      validate: {
        validator: (factors) => Array.isArray(factors) && factors.length > 0,
        message: 'A score must include at least one factor.',
      },
    },
    computedAt: { type: Date, default: Date.now },
    version: { type: String, default: 'v1', trim: true },
  },
  { timestamps: true }
);

scoreSchema.pre('validate', function verifyWeightedSum(next) {
  if (!Array.isArray(this.factors) || this.factors.length === 0) {
    return next();
  }

  const weightSum = this.factors.reduce(
    (sum, factor) => sum + (Number(factor.weight) || 0),
    0
  );
  if (Math.abs(weightSum - 1) > 0.01) {
    this.invalidate(
      'factors',
      `Factor weights must sum to 1 (received ${weightSum.toFixed(3)}).`
    );
  }

  const contributionSum = this.factors.reduce(
    (sum, factor) => sum + (Number(factor.contribution) || 0),
    0
  );
  if (Math.abs(contributionSum - Number(this.value)) > 0.01) {
    this.invalidate(
      'value',
      `Score value must equal the sum of factor contributions (${contributionSum.toFixed(2)}).`
    );
  }

  next();
});

scoreSchema.index({ product: 1, computedAt: -1 });
scoreSchema.index({ product: 1, version: 1 });

export const Score = mongoose.model('Score', scoreSchema);
export default Score;
