import mongoose from "mongoose";
import dotenv from "dotenv";
import { Product } from "../models/Product.js";
import { Signal } from "../models/Signal.js";

dotenv.config();

function mapSeverity(classification) {
  if (!classification) return "low";
  const c = String(classification).trim().toLowerCase();
  if (c === "class i" || c === "i") return "high";
  if (c === "class ii" || c === "ii") return "medium";
  if (c === "class iii" || c === "iii") return "low";
  return "low";
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);

  // 1. Blank TE code "" -> null in Product
  const teResult = await Product.updateMany({ teCode: "" }, { $set: { teCode: null } });
  console.log(`TE code migration: matched=${teResult.matchedCount} modified=${teResult.modifiedCount}`);

  // 2. Remap openFDA raw_classification severity strings to HIGH/MEDIUM/LOW
  const openFDASignals = await Signal.find({ sourceName: "openFDA", type: "RECALL" });
  let signalModified = 0;
  for (const s of openFDASignals) {
    const raw = s.raw_classification || "";
    const newSeverity = mapSeverity(raw);
    if (s.severity !== newSeverity) {
      s.severity = newSeverity;
      await s.save();
      signalModified++;
    }
  }
  console.log(`Signal severity remap: modified=${signalModified}`);

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
