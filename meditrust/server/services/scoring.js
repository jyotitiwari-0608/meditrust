import fs from "fs";
import path from "path";
import { Score } from "../models/Score.js";
import { Signal } from "../models/Signal.js";
import { Product } from "../models/Product.js";
import { Manufacturer } from "../models/Manufacturer.js";

const weightsPath = path.join(process.cwd(), "config", "weights.json");
let weights;
try {
  weights = JSON.parse(fs.readFileSync(weightsPath, "utf8"));
} catch (e) {
  throw new Error(`Failed to load scoring weights from ${weightsPath}: ${e.message}`);
}

const REQUIRED_KEYS = [
  "regulatory_approval",
  "recent_nsq_count",
  "recall_history",
  "years_of_market_presence",
  "num_approved_products",
  "regulatory_tier",
];
for (const k of REQUIRED_KEYS) {
  if (!(k in weights)) {
    throw new Error(`Missing required weight key: ${k}`);
  }
}
const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
if (Math.abs(totalWeight - 1) > 1e-9) {
  throw new Error(
    `Scoring weights must sum to 1, but they sum to ${totalWeight}. Fix config/weights.json.`
  );
}

// TE code value mapping per spec 5.1 (A=1.0, B=0.3, none/null=0).
const TE_CODE_VALUE = { A: 1.0, AB: 1.0, B: 0.3, BC: 0.3, null: 0, undefined: 0, "": 0 };

const COLD_START_THRESHOLD = 5;
const TIER_BASELINE = { tier1: 60, tier2: 45, tier3: 30 };
const TIME_DECAY_HALF_LIFE_DAYS = 365;
const SCORE_VERSION = "rules-v1";

export const factorWeights = weights;

export function bandFor(score) {
  if (score >= 75) return "High";
  if (score >= 50) return "Moderate";
  if (score < 50) return "Low";
  return "LimitedData";
}

function isFutureDated(date) {
  return new Date(date).getTime() > Date.now();
}

function timeDecay(date) {
  const months = (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24 * 30.44);
  return Math.pow(0.5, months / 36);
}

function severityWeight(sev) {
  return { low: 1, medium: 2, high: 3, critical: 4 }[sev] || 1;
}

function teCodeValue(teCode) {
  if (teCode === null || teCode === undefined || teCode === "") return 0;
  const key = String(teCode).trim().toUpperCase();
  return TE_CODE_VALUE[key] !== undefined ? TE_CODE_VALUE[key] : 0;
}

export function computeFactors({ manufacturer, signals = [], numProducts = 0, teCode = null }) {
  // Ignore future-dated signals.
  const validSignals = signals.filter((s) => !isFutureDated(s.date));

  const tier = manufacturer.regulatoryTier || "tier2";
  const years = manufacturer.yearsOfMarketPresence || 0;

  const recentNsq = validSignals.filter((s) => s.type === "NSQ" && timeDecay(s.date) > 0.5);
  const nsqValue = Math.max(0, (1 - recentNsq.length / 4) * 100);

  const recalls = validSignals.filter((s) => s.type === "RECALL");
  const recallRisk = recalls.reduce(
    (sum, s) => sum + severityWeight(s.severity) * timeDecay(s.date),
    0
  );
  const recallValue = Math.max(0, (1 - recallRisk / 6) * 100);

  // Approval factor driven by TE code.
  const approvalValue = teCodeValue(teCode) * 100;
  const yearsValue = Math.min(100, (years / 15) * 100);
  const productsValue = Math.min(100, (Math.log(1 + numProducts) / Math.log(1 + 20)) * 100);
  const tierValue = { tier1: 100, tier2: 60, tier3: 30 }[tier] || 60;

  const factors = [
    {
      name: "regulatory_approval",
      value: approvalValue,
      weight: weights.regulatory_approval,
      evidence: validSignals.filter((s) => s.type === "APPROVAL").map((s) => s._id),
    },
    {
      name: "recent_nsq_count",
      value: nsqValue,
      weight: weights.recent_nsq_count,
      evidence: recentNsq.map((s) => s._id),
    },
    {
      name: "recall_history",
      value: recallValue,
      weight: weights.recall_history,
      evidence: recalls.map((s) => s._id),
    },
    {
      name: "years_of_market_presence",
      value: yearsValue,
      weight: weights.years_of_market_presence,
      evidence: [],
    },
    {
      name: "num_approved_products",
      value: productsValue,
      weight: weights.num_approved_products,
      evidence: [],
    },
    {
      name: "regulatory_tier",
      value: tierValue,
      weight: weights.regulatory_tier,
      evidence: [],
    },
  ];

  let score = 0;
  for (const f of factors) {
    f.contribution = Number(((f.value * f.weight) / totalWeight).toFixed(2));
    score += f.contribution;
  }
  score = Math.round(Math.min(100, Math.max(0, score)));

  return {
    score,
    band: bandFor(score),
    factors,
    version: SCORE_VERSION,
    computedAt: new Date().toISOString(),
  };
}

export function coldStartBaseline(manufacturer) {
  const tier = manufacturer.regulatoryTier || "tier2";
  const score = TIER_BASELINE[tier] || 45;
  return {
    score,
    band: "LimitedData",
    factors: [
      {
        name: "cold_start_baseline",
        value: score,
        weight: 1,
        contribution: score,
        evidence: [],
      },
    ],
    limitedData: true,
    version: SCORE_VERSION,
    computedAt: new Date().toISOString(),
  };
}

export async function scoreManufacturer(manufacturerId) {
  const manufacturer = await Manufacturer.findById(manufacturerId);
  if (!manufacturer) throw new Error("manufacturer not found");
  const signals = await Signal.find({ manufacturer: manufacturerId });
  const numProducts = await Product.countDocuments({ manufacturer: manufacturerId });

  // Cold start applies only when signals+products below minimum AND no HIGH-severity signal.
  const hasHighSeverity = signals.some(
    (s) => !isFutureDated(s.date) && (s.severity === "high" || s.severity === "critical")
  );
  if (signals.length + numProducts < COLD_START_THRESHOLD && !hasHighSeverity) {
    return {
      ...coldStartBaseline(manufacturer),
      manufacturer,
      limitedData: true,
    };
  }

  // Use TE code from the manufacturer's first product if available.
  let teCode = null;
  const sampleProduct = await Product.findOne({ manufacturer: manufacturerId }).lean();
  if (sampleProduct) teCode = sampleProduct.teCode;

  const { score, factors, version, computedAt } = computeFactors({
    manufacturer,
    signals: validSignals(signals),
    numProducts,
    teCode,
  });
  const band = bandFor(score);
  return { score, band, factors, manufacturer, limitedData: false, version, computedAt };
}

export function validSignals(signals) {
  return signals.filter((s) => !isFutureDated(s.date));
}

export async function saveScore(manufacturerId, productId, result) {
  const scoreDoc = await Score.create({
    product: productId || null,
    manufacturer: manufacturerId,
    value: result.score,
    band: result.band,
    version: result.version || SCORE_VERSION,
    computedAt: result.computedAt || new Date(),
    factors: result.factors.map((f) => ({
      name: f.name,
      value: f.value,
      weight: f.weight,
      contribution: f.contribution,
      evidence: f.evidence || [],
    })),
    limitedData: result.limitedData || false,
  });
  return scoreDoc;
}

export default {
  computeFactors,
  coldStartBaseline,
  scoreManufacturer,
  saveScore,
  bandFor,
  factorWeights,
};
