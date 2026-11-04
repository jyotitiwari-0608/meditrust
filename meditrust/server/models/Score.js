import mongoose from "mongoose";

const scoreSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    manufacturer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Manufacturer",
      index: true,
    },
    value: { type: Number, required: true, min: 0, max: 100 },
    band: {
      type: String,
      enum: ["High", "Moderate", "Low", "LimitedData"],
      required: true,
    },
    factors: [
      {
        name: String,
        value: Number,
        weight: Number,
        contribution: Number,
        evidence: [{ type: mongoose.Schema.Types.ObjectId, ref: "Signal" }],
      },
    ],
    computedAt: { type: Date, default: Date.now },
    version: { type: String, default: "1.0.0" },
    isDemo: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

scoreSchema.index({ product: 1, version: 1 });

export const Score = mongoose.model("Score", scoreSchema);
