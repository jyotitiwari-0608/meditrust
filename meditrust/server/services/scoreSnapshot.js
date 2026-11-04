import { Signal } from "../models/Signal.js";
import { Product } from "../models/Product.js";
import { Manufacturer } from "../models/Manufacturer.js";
import { computeFactors, coldStartBaseline, bandFor, validSignals } from "./scoring.js";

const COLD_START_THRESHOLD = 5;

async function gatherSignalsAndProducts(manufacturerId) {
  const [signals, numProducts] = await Promise.all([
    Signal.find({ manufacturer: manufacturerId }).lean(),
    Product.countDocuments({ manufacturer: manufacturerId }),
  ]);
  return { signals, numProducts };
}

export async function scoreSnapshot(manufacturerId) {
  const manufacturer = await Manufacturer.findById(manufacturerId);
  if (!manufacturer) {
    return { score: 40, band: "LimitedData", limitedData: true, factors: [] };
  }
  const { signals, numProducts } = await gatherSignalsAndProducts(manufacturerId);

  const hasHighSeverity = signals.some(
    (s) => !(s.date > Date.now()) && (s.severity === "high" || s.severity === "critical")
  );
  if (signals.length + numProducts < COLD_START_THRESHOLD && !hasHighSeverity) {
    const base = coldStartBaseline(manufacturer);
    return { score: base.score, band: base.band, limitedData: true, factors: base.factors };
  }

  let teCode = null;
  const sampleProduct = await Product.findOne({ manufacturer: manufacturerId }).lean();
  if (sampleProduct) teCode = sampleProduct.teCode;

  const { score, factors } = computeFactors({
    manufacturer,
    signals: validSignals(signals),
    numProducts,
    teCode,
  });
  return { score, band: bandFor(score), limitedData: false, factors };
}

export default { scoreSnapshot };
