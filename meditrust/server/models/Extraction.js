import mongoose from "mongoose";

const extractionSchema = new mongoose.Schema(
  {
    signal: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Signal",
      required: true,
      index: true,
    },
    json: mongoose.Schema.Types.Mixed,
    confidence: { type: Number, min: 0, max: 1 },
    needsReview: { type: Boolean, default: false },
    provider: { type: String, trim: true },
    reviewer: { type: String, trim: true },
    reviewedAt: { type: Date },
    isDemo: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

export const Extraction = mongoose.model("Extraction", extractionSchema);
