import mongoose from "mongoose";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { Drug } from "../models/Drug.js";
import { Manufacturer } from "../models/Manufacturer.js";
import { Product } from "../models/Product.js";
import { Brand } from "../models/Brand.js";
const pilot = JSON.parse(fs.readFileSync(new URL("../config/pilot.json", import.meta.url), "utf8"));

dotenv.config();

const FILE_PATH = process.env.ORANGE_BOOK_PATH || path.resolve("data/raw/orangebook_products.txt");
const CATEGORY = pilot.category;

async function upsertManufacturer(name) {
  if (!name) return null;
  const existing = await Manufacturer.findOne({ name: { $regex: new RegExp(name, "i") } });
  if (existing) return existing;
  return Manufacturer.create({ name, country: "US", regulatoryTier: "tier1" });
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  if (!fs.existsSync(FILE_PATH)) {
    console.log(`Orange Book file not found: ${FILE_PATH}`);
    await mongoose.disconnect();
    process.exit(0);
  }
  const raw = fs.readFileSync(FILE_PATH, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  let rowsRead = lines.length;
  let inserted = 0,
    updated = 0,
    skipped = 0,
    errors = 0;
  const manufacturerCache = new Map();
  const drugCache = new Map();
  const operations = [];
  for (const line of lines) {
    const cols = line.split("~");
    const activeIngredient = (cols[6] || "").trim();
    const strength = (cols[3] || "").trim();
    const form = (cols[2] || "tablet").trim();
    const teCodeRaw = (cols[8] || "").trim();
    const teCode = teCodeRaw || null;
    const applicant = (cols[11] || "").trim();
    const drugName = (cols[5] || activeIngredient).trim();
    if (!activeIngredient || !pilot.salts.some((s) => activeIngredient.toLowerCase().includes(s.toLowerCase()))) {
      skipped++;
      continue;
    }
    // Multi-ingredient detection: active ingredient contains a separator indicating multiple salts.
    if (/[,;/&]/.test(activeIngredient)) {
      skipped++;
      continue;
    }
    let drug = drugCache.get(activeIngredient + "|" + strength);
    if (!drug) {
      drug = await Drug.findOne({ salt: activeIngredient, strength });
      if (!drug) {
        const created = await Drug.create({ salt: activeIngredient, strength, form, atcCode: "", category: CATEGORY });
        drug = created;
        inserted++;
      } else {
        updated++;
      }
      drugCache.set(activeIngredient + "|" + strength, drug);
    }
    let mfr = manufacturerCache.get(applicant);
    if (!mfr) {
      mfr = await upsertManufacturer(applicant);
      manufacturerCache.set(applicant, mfr);
    }
    if (!mfr) continue;
    const brand = await Brand.findOneAndUpdate(
      { name: `${applicant} ${drugName}`, manufacturer: mfr._id },
      { name: `${applicant} ${drugName}`, manufacturer: mfr._id },
      { upsert: true, new: true }
    );
    operations.push({
      updateOne: {
        filter: { drug: drug._id, manufacturer: mfr._id },
        update: { $set: { brand: brand.name, mrp: null, teCode, source: "orange_book" } },
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
    errors = (result.writeErrors || []).length;
  }
  console.log(
    `Orange Book: rowsRead=${rowsRead} inserted=${dbInserted} updated=${dbUpdated} skipped=${skipped} errors=${errors}`
  );
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
