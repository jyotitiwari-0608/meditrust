import mongoose from "mongoose";

const manufacturerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, index: true },
    aliases: [{ type: String, trim: true }],
    country: { type: String, trim: true },
    regulatoryTier: {
      type: String,
      enum: ["tier1", "tier2", "tier3"],
      default: "tier2",
    },
    yearsOfMarketPresence: { type: Number, default: 0 },
    isDemo: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

manufacturerSchema.index({ name: "text" });

export const Manufacturer = mongoose.model("Manufacturer", manufacturerSchema);
