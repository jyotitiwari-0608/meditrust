import mongoose from "mongoose";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { Manufacturer } from "../models/Manufacturer.js";
import { Signal } from "../models/Signal.js";
import { Product } from "../models/Product.js";
import { computeFactors, coldStartBaseline, bandFor } from "../services/scoring.js";
import LR from "ml-logistic-regression";

dotenv.config();

const SPLIT_DATE = new Date("2023-01-01");
const SERIOUS = ["high", "critical"];
const MODEL_OUT = path.resolve("config/model_weights.json");
const ALPHA = 0.3;
const COLD_START_THRESHOLD = 5;

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function ruleScoreFromFactors(factors) {
  return factors.reduce((sum, f) => sum + (f.contribution || 0), 0);
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const manufacturers = await Manufacturer.find();
  const rows = [];
  for (const mfr of manufacturers) {
    const preSignals = await Signal.find({
      manufacturer: mfr._id,
      date: { $lt: SPLIT_DATE },
    });
    const postSignals = await Signal.find({
      manufacturer: mfr._id,
      date: { $gte: SPLIT_DATE },
    });
    const numProducts = await Product.countDocuments({ manufacturer: mfr._id });

    // Cold start skips the model.
    const hasHighSeverity = preSignals.some(
      (s) => SERIOUS.includes(s.severity)
    );
    const isColdStart =
      preSignals.length + numProducts < COLD_START_THRESHOLD && !hasHighSeverity;

    const { factors } = computeFactors({
      manufacturer: mfr,
      signals: preSignals,
      numProducts,
    });
    const featureOrder = [
      "regulatory_approval",
      "recent_nsq_count",
      "recall_history",
      "years_of_market_presence",
      "num_approved_products",
      "regulatory_tier",
    ];
    const x = featureOrder.map((name) => {
      const f = factors.find((ff) => ff.name === name);
      return f ? f.value : 0;
    });
    const label = postSignals.some(
      (s) => (s.type === "NSQ" || s.type === "RECALL") && SERIOUS.includes(s.severity)
    )
      ? 1
      : 0;
    const ruleScore = ruleScoreFromFactors(factors);
    rows.push({ x, y: label, name: mfr.name, ruleScore, isColdStart });
  }

  console.log(`Total manufacturers: ${rows.length}`);
  const positives = rows.filter((r) => r.y === 1).length;
  const negatives = rows.filter((r) => r.y === 0).length;
  console.log(`Positives (serious post-split signal): ${positives}`);
  console.log(`Negatives: ${negatives}`);

  // Majority-class baseline.
  const majorityClass = positives >= negatives ? 1 : 0;
  const majorityBaseline =
    rows.filter((r) => r.y === majorityClass).length / rows.length;
  console.log(`Majority-class baseline accuracy: ${(majorityBaseline * 100).toFixed(1)}%`);

  // Rule-score comparison: predict serious if rule score < 50.
  let ruleCorrect = 0;
  for (const r of rows) {
    const rulePred = r.ruleScore < 50 ? 1 : 0;
    if (rulePred === r.y) ruleCorrect++;
  }
  const ruleAccuracy = rows.length ? ruleCorrect / rows.length : 0;
  console.log(`Rule-score-only accuracy: ${(ruleAccuracy * 100).toFixed(1)}%`);

  if (rows.length < 10) {
    console.log("Not enough data to train. Documented small-data limitation.");
    fs.writeFileSync(MODEL_OUT, JSON.stringify({ note: "insufficient data" }, null, 2));
    await mongoose.disconnect();
    process.exit(0);
  }

  // Train/test split (exclude cold-start from model features).
  const modelRows = rows.filter((r) => !r.isColdStart);
  const shuffled = [...modelRows].sort(() => 0.5 - Math.random());
  const cut = Math.floor(shuffled.length * 0.8);
  const train = shuffled.slice(0, cut);
  const test = shuffled.slice(cut);

  const Xtrain = train.map((r) => r.x);
  const Ytrain = train.map((r) => r.y);
  const Xtest = test.map((r) => r.x);
  const Ytest = test.map((r) => r.y);

  const lr = new LR();
  lr.train(Xtrain, Ytrain);

  const preds = lr.predict(Xtest);
  let tp = 0,
    fp = 0,
    fn = 0,
    tn = 0,
    correct = 0;
  for (let i = 0; i < preds.length; i++) {
    if (preds[i] === Ytest[i]) correct++;
    if (preds[i] === 1 && Ytest[i] === 1) tp++;
    if (preds[i] === 1 && Ytest[i] === 0) fp++;
    if (preds[i] === 0 && Ytest[i] === 1) fn++;
    if (preds[i] === 0 && Ytest[i] === 0) tn++;
  }
  const accuracy = correct / preds.length;
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  console.log(`Train n=${train.length}, Test n=${test.length}`);
  console.log(`Accuracy: ${(accuracy * 100).toFixed(1)}%`);
  console.log(`Precision: ${(precision * 100).toFixed(1)}%`);
  console.log(`Recall: ${(recall * 100).toFixed(1)}%`);
  console.log(`F1: ${(f1 * 100).toFixed(1)}%`);
  console.log(`Confusion: TP=${tp} FP=${fp} TN=${tn} FN=${fn}`);

  // Blended mode hand-calculated example.
  const exampleRule = 70;
  const exampleP = 0.2;
  const exampleBlended = (1 - ALPHA) * exampleRule + ALPHA * (100 - 100 * exampleP);
  console.log(
    `Blended example: rule=${exampleRule} p=${exampleP} -> blended=${exampleBlended.toFixed(1)}`
  );

  const modelJson = lr.toJSON();
  fs.writeFileSync(
    MODEL_OUT,
    JSON.stringify(
      {
        model: modelJson,
        alpha: ALPHA,
        trainedAt: new Date().toISOString(),
        majorityBaseline,
        ruleAccuracy,
      },
      null,
      2
    )
  );
  console.log(`Saved weights to ${MODEL_OUT}`);
  console.log("LIMITATION: small labelled dataset — treat as proof-of-concept risk model only.");

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
