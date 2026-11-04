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
  process.env.INDIAN_MEDS_PATH || path.resolve("data/raw/indian_medicines.csv");
const CATEGORY = pilot.category;

async function upsertManufacturer(name, all) {
  if (!name) return null;
  let mfr = all.find((m) => m.name.toLowerCase() === name.toLowerCase());
  if (!mfr) {
    mfr = await Manufacturer.create({
      name,
      country: "India",
      regulatoryTier: "tier2",
    });
    all.push(mfr);
  }
  return mfr;
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  if (!fs.existsSync(FILE_PATH)) {
    console.log(`Indian meds file not found: ${FILE_PATH}`);
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
    if (!salt || !pilot.salts.some((s) => salt.toLowerCase().includes(s.toLowerCase()))) {
      skipped++;
      continue;
    }
    // Multi-ingredient: more than one salt token detected crudely.
    if (composition.split(/[,;/&]/).length > 1) {
      skipped++;
      continue;
    }
    let drug;
    try {
      drug = await Drug.findOne({ salt, strength, category: CATEGORY });
    } catch (e) {
      errors++;
      continue;
    }
    if (!drug) {
      try {
        drug = await Drug.create({ salt, strength, form, atcCode: "", category: CATEGORY });
        inserted++;
      } catch (e) {
        errors++;
        continue;
      }
    } else {
      updated++;
    }
    const mfrName = rec.manufacturer || rec.mfr || "";
    const mfr = await upsertManufacturer(mfrName, manufacturers);
    if (!mfr) continue;
    const brandName = rec.brand || rec.product_name || salt;
    const mrp = Number(rec.price || rec.mrp || 0) || undefined;
    operations.push({
      updateOne: {
        filter: { drug: drug._id, manufacturer: mfr._id },
        update: { $set: { brand: brandName, mrp, teCode: "", source: "kaggle" } },
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
    `Indian meds: rowsRead=${rowsRead} inserted=${dbInserted} updated=${dbUpdated} skipped=${skipped} errors=${errors}`
  );
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
