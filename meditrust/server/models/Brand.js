import mongoose from "mongoose";

const brandSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, index: true },
    manufacturer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Manufacturer",
      index: true,
    },
    isDemo: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

brandSchema.index({ name: "text" });

export const Brand = mongoose.model("Brand", brandSchema);
