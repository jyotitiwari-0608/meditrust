import mongoose from "mongoose";

const auditSchema = new mongoose.Schema(
  {
    actor: { type: String, trim: true },
    action: { type: String, trim: true },
    fromBrand: { type: String, trim: true },
    toBrand: { type: String, trim: true },
    drug: { type: String, trim: true },
    riskFlags: [String],
    confirmed: { type: Boolean, default: false },
    ip: { type: String, trim: true },
    metadata: mongoose.Schema.Types.Mixed,
    isDemo: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

auditSchema.index({ createdAt: -1 });
auditSchema.index({ action: 1, confirmed: 1 });

export const Audit = mongoose.model("Audit", auditSchema);
