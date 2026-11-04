import mongoose from "mongoose";

const productSchema = new mongoose.Schema(
  {
    drug: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Drug",
      required: true,
      index: true,
    },
    manufacturer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Manufacturer",
      required: true,
      index: true,
    },
    brand: { type: String, trim: true },
    mrp: { type: Number, min: 0 },
    teCode: { type: String, trim: true },
    source: { type: String, trim: true },
    isJanAushadhi: { type: Boolean, default: false, index: true },
    isDemo: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

productSchema.index({ drug: 1, manufacturer: 1 });
productSchema.index({ brand: "text" });

export const Product = mongoose.model("Product", productSchema);
