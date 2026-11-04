import mongoose from "mongoose";

const signalSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", index: true },
    manufacturer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Manufacturer",
      index: true,
    },
    type: {
      type: String,
      enum: ["NSQ", "RECALL", "INSPECTION", "APPROVAL"],
      required: true,
    },
    date: { type: Date, required: true },
    severity: { type: String, enum: ["low", "medium", "high", "critical"] },
    raw_classification: { type: String, trim: true },
    sourceName: { type: String, trim: true },
    sourceUrl: { type: String, trim: true },
    rawText: { type: String },
    matchedVia: { type: String, trim: true },
    matchStatus: { type: String, enum: ["MATCHED", "UNMATCHED", "REVIEW"], default: "MATCHED" },
    manualReview: { type: Boolean, default: false },
    isDemo: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

signalSchema.index({ type: 1, date: -1 });
signalSchema.index({ rawText: "text" });
signalSchema.index({ sourceUrl: 1, rawText: 1 }, { unique: true });

export const Signal = mongoose.model("Signal", signalSchema);
