import mongoose from "mongoose";

const drugSchema = new mongoose.Schema(
  {
    salt: { type: String, required: true, trim: true, index: true },
    strength: { type: String, required: true, trim: true },
    form: { type: String, required: true, trim: true },
    atcCode: { type: String, trim: true },
    category: { type: String, trim: true, index: true },
    isDemo: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

drugSchema.index({ salt: "text", strength: "text" });

export const Drug = mongoose.model("Drug", drugSchema);
