import mongoose from "mongoose";
import dotenv from "dotenv";
import { Drug } from "../models/Drug.js";
import { Manufacturer } from "../models/Manufacturer.js";
import { Product } from "../models/Product.js";
import { Brand } from "../models/Brand.js";

dotenv.config();

const SEED_DRUGS = [
  { salt: "amlodipine", strength: "5 mg", form: "tablet", atcCode: "C08CA01", category: "antihypertensives" },
  { salt: "telmisartan", strength: "40 mg", form: "tablet", atcCode: "C09CA07", category: "antihypertensives" },
  { salt: "metformin", strength: "500 mg", form: "tablet", atcCode: "A10BA02", category: "antidiabetics" },
];

const SEED_MANUFACTURERS = [
  { name: "Cipla Ltd", aliases: ["Cipla"], country: "India", regulatoryTier: "tier1", yearsOfMarketPresence: 40 },
  { name: "Sun Pharma", aliases: ["Sun Pharmaceutical"], country: "India", regulatoryTier: "tier1", yearsOfMarketPresence: 40 },
  { name: "Dr. Reddys", aliases: ["Dr Reddy's Laboratories"], country: "India", regulatoryTier: "tier1", yearsOfMarketPresence: 40 },
  { name: "Unknown Mfr", aliases: [], country: "India", regulatoryTier: "tier3", yearsOfMarketPresence: 2 },
];

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  await Drug.deleteMany({});
  await Manufacturer.deleteMany({});
  await Product.deleteMany({});
  await Brand.deleteMany({});

  const drugs = await Drug.insertMany(SEED_DRUGS);
  const manufacturers = await Manufacturer.insertMany(SEED_MANUFACTURERS);

  const products = [];
  for (const drug of drugs) {
    for (const mfr of manufacturers) {
      const brand = await Brand.create({
        name: `${mfr.name} ${drug.salt}`,
        manufacturer: mfr._id,
      });
      products.push({
        drug: drug._id,
        manufacturer: mfr._id,
        brand: brand.name,
        mrp: Math.round((Math.random() * 100 + 10) * 100) / 100,
        teCode: "AB",
        source: "seed",
      });
    }
  }
  await Product.insertMany(products);

  console.log(
    `Seeded: ${drugs.length} drugs, ${manufacturers.length} manufacturers, ${products.length} products`
  );
  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
