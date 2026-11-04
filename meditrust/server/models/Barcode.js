import mongoose from "mongoose";

const barcodeSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, index: true },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      index: true,
    },
    brand: { type: String, trim: true },
    drug: { type: String, trim: true },
    source: { type: String, trim: true },
    isDemo: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

export const Barcode = mongoose.model("Barcode", barcodeSchema);
