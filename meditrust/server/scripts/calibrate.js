import fs from "fs";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { Manufacturer } from "../models/Manufacturer.js";
import { Product } from "../models/Product.js";
import { Signal } from "../models/Signal.js";
import { scoreManufacturer } from "../services/scoring.js";
const reference = JSON.parse(fs.readFileSync(new URL("../config/reference.json", import.meta.url), "utf8"));

dotenv.config();

const COLD_START_THRESHOLD = 5;
const MISMATCH_THRESHOLD = 10;

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  let matched = 0;
  let mismatchCount = 0;
  for (const ref of reference.manufacturers) {
    const mfr = await Manufacturer.findOne({
      name: { $regex: new RegExp(ref.name.replace(/\.+/g, ""), "i") },
    });
    if (!mfr) {
      console.log(`${ref.name}: not found in DB`);
      continue;
    }
    const signals = await Signal.find({ manufacturer: mfr._id });
    const numProducts = await Product.countDocuments({ manufacturer: mfr._id });
    if (signals.length + numProducts < COLD_START_THRESHOLD) {
      console.log(`${ref.name}: cold-start (LimitedData), expected ~${ref.expected}`);
      continue;
    }
    const result = await scoreManufacturer(mfr._id);
    matched++;
    const diff = Math.abs(result.score - ref.expected);
    const mismatch = diff > MISMATCH_THRESHOLD ? " MISMATCH" : "";
    if (mismatch) mismatchCount++;
    console.log(
      `${ref.name}: computed=${result.score} band=${result.band} expected=${ref.expected} diff=${diff}${mismatch}`
    );
  }
  console.log(`Calibrated ${matched} manufacturers, ${mismatchCount} MISMATCH`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
