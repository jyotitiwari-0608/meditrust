import mongoose from "mongoose";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { Drug } from "../models/Drug.js";
import { Manufacturer } from "../models/Manufacturer.js";
import { Product } from "../models/Product.js";
import { Brand } from "../models/Brand.js";
import { normalizeComposition } from "../utils/normalize.js";
const pilot = JSON.parse(fs.readFileSync(new URL("../config/pilot.json", import.meta.url), "utf8"));

dotenv.config();

const FILE_PATH =
  process.env.JAN_AUSHADHI_PATH || path.resolve("data/raw/jan_aushadhi.csv");
const CATEGORY = pilot.category;

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  if (!fs.existsSync(FILE_PATH)) {
    console.log(`Jan Aushadhi file not found: ${FILE_PATH}`);
    await mongoose.disconnect();
    process.exit(0);
  }
  const raw = fs.readFileSync(FILE_PATH, "utf8");
  const records = parse(raw, { columns: true, skip_empty_lines: true, trim: true });
  let rowsRead = records.length;
  let inserted = 0,
    updated = 0,
    skipped = 0,
    errors = 0;
  const manufacturers = await Manufacturer.find();
  const operations = [];
  for (const rec of records) {
    const composition = rec.composition || rec.drug || rec.name || "";
    const { salt, strength, form } = normalizeComposition(composition);
    if (!salt) continue;
    let drug;
    try {
      drug = await Drug.findOne({ salt, strength, category: CATEGORY });
    } catch (e) {
      errors++;
      continue;
    }
    if (!drug) {
      try {
        drug = await Drug.create({ salt, strength, form, atcCode: "", category: CATEGORY, source: "jan_aushadhi" });
        inserted++;
      } catch (e) {
        errors++;
        continue;
      }
    } else {
      updated++;
    }
    const mfrName = rec.manufacturer || "Bureau of Pharma PSUs of India";
    let mfr = manufacturers.find((m) => m.name.toLowerCase() === mfrName.toLowerCase());
    if (!mfr) {
      try {
        mfr = await Manufacturer.create({ name: mfrName, country: "India", regulatoryTier: "tier1" });
        manufacturers.push(mfr);
        inserted++;
      } catch (e) {
        errors++;
        continue;
      }
    }
    const mrp = Number(rec.price || rec.mrp || 0) || undefined;
    operations.push({
      updateOne: {
        filter: { drug: drug._id, manufacturer: mfr._id },
        update: { $set: { brand: "Jan Aushadhi Generic", mrp, teCode: "", source: "jan_aushadhi", isJanAushadhi: true } },
        upsert: true,
      },
    });
  }
  let dbInserted = 0,
    dbUpdated = 0;
  if (operations.length) {
    const result = await Product.bulkWrite(operations, { ordered: false });
    dbInserted = result.upsertedCount || 0;
    dbUpdated = result.modifiedCount || 0;
    errors += (result.writeErrors || []).length;
  }
  console.log(
    `Jan Aushadhi: rowsRead=${rowsRead} inserted=${dbInserted} updated=${dbUpdated} skipped=${skipped} errors=${errors}`
  );
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
