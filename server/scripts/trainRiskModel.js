import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Manufacturer, Product, Signal } from '../src/models/index.js';
import { scoreManufacturer } from '../src/services/scoring.js';
import { loadWeights } from '../src/utils/config.js';
import { normalizeName } from '../src/utils/normalize.js';
import { fuzzyManufacturerMatch } from '../src/utils/fuzzy.js';
import { isMain } from '../src/utils/isMain.js';
import { loadReference } from '../src/utils/config.js';
import LogisticRegression from 'ml-logistic-regression';
import { Matrix } from 'ml-matrix';

const DAY_MS = 24 * 60 * 60 * 1000;
const HORIZON_DAYS = Number(process.env.TRAIN_HORIZON_DAYS) || 365;
const CUTOFF_STEP_DAYS = Number(process.env.TRAIN_CUTOFF_STEP_DAYS) || 90;
const SERIOUS_SEVERITIES = new Set(['HIGH', 'CRITICAL']);
const MODEL_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../config/riskModel.json'
);

function isSerious(signal) {
  if (signal.type === 'NSQ') return true;
  return signal.type === 'RECALL' && SERIOUS_SEVERITIES.has(signal.severity);
}

function buildCutoffs(minDate, maxDate) {
  const cutoffs = [];
  const end = new Date(maxDate.getTime() - CUTOFF_STEP_DAYS * DAY_MS);
  for (
    let time = minDate.getTime();
    time <= end.getTime();
    time += CUTOFF_STEP_DAYS * DAY_MS
  ) {
    cutoffs.push(new Date(time));
  }
  return cutoffs;
}

function metrics(labels, predictions) {
  let tp = 0;
  let tn = 0;
  let fp = 0;
  let fn = 0;

  labels.forEach((label, index) => {
    const predicted = predictions[index];
    if (label === 1 && predicted === 1) tp += 1;
    if (label === 0 && predicted === 0) tn += 1;
    if (label === 0 && predicted === 1) fp += 1;
    if (label === 1 && predicted === 0) fn += 1;
  });

  const total = labels.length;
  return {
    total,
    tp,
    tn,
    fp,
    fn,
    accuracy: total ? Number(((tp + tn) / total).toFixed(4)) : 0,
    precision: tp + fp ? Number((tp / (tp + fp)).toFixed(4)) : 0,
    recall: tp + fn ? Number((tp / (tp + fn)).toFixed(4)) : 0,
  };
}

export async function buildDataset() {
  const weights = loadWeights();
  const manufacturers = await Manufacturer.find({}).lean();
  const samples = [];
  let skippedColdStart = 0;
  let skippedNoCutoff = 0;

  for (const manufacturer of manufacturers) {
    const products = await Product.find({ manufacturer: manufacturer._id }).lean();
    const signals = await Signal.find({
      $or: [
        { manufacturer: manufacturer._id },
        { product: { $in: products.map((product) => product._id) } },
      ],
    }).lean();

    const dates = [
      manufacturer.createdAt,
      ...products.map((product) => product.createdAt),
      ...signals.map((signal) => signal.date),
    ]
      .filter(Boolean)
      .map((date) => new Date(date).getTime())
      .filter((time) => Number.isFinite(time));

    if (dates.length === 0) {
      skippedNoCutoff += 1;
      continue;
    }

    const cutoffs = buildCutoffs(new Date(Math.min(...dates)), new Date(Math.max(...dates)));
    if (cutoffs.length === 0) {
      skippedNoCutoff += 1;
      continue;
    }

    for (const cutoff of cutoffs) {
      const cutoffTime = cutoff.getTime();
      const windowEnd = cutoffTime + HORIZON_DAYS * DAY_MS;

      const featureProducts = products;
      const featureSignals = signals.filter(
        (signal) => new Date(signal.date).getTime() < cutoffTime
      );

      const result = await scoreManufacturer(manufacturer._id, {
        now: cutoff,
        products: featureProducts,
        signals: featureSignals,
        weights,
      });

      if (result.coldStart) {
        skippedColdStart += 1;
        continue;
      }

      const label = signals.some((signal) => {
        const time = new Date(signal.date).getTime();
        return time >= cutoffTime && time < windowEnd && isSerious(signal);
      })
        ? 1
        : 0;

      samples.push({
        manufacturerId: String(manufacturer._id),
        manufacturerName: manufacturer.name,
        cutoff: cutoff.toISOString(),
        label,
        features: Object.fromEntries(
          result.factors.map((factor) => [factor.name, factor.value])
        ),
      });
    }
  }

  return { samples, skippedColdStart, skippedNoCutoff, weights };
}

function temporalSplit(samples) {
  const cutoffs = [...new Set(samples.map((sample) => sample.cutoff))].sort();
  if (cutoffs.length < 2) {
    return { train: samples, test: [] };
  }

  const splitIndex = Math.max(1, Math.floor(cutoffs.length * 0.7));
  const splitCutoff = cutoffs[splitIndex];
  const train = samples.filter((sample) => sample.cutoff < splitCutoff);
  const test = samples.filter((sample) => sample.cutoff >= splitCutoff);
  return { train, test };
}

function toMatrix(samples, features) {
  return new Matrix(
    samples.map((sample) => features.map((feature) => sample.features[feature] / 100))
  );
}

function toLabels(samples) {
  return Matrix.columnVector(samples.map((sample) => sample.label));
}

export function trainModel(samples, features) {
  const { train, test } = temporalSplit(samples);
  if (train.length === 0) throw new Error('No training samples available.');

  const trainLabels = train.map((sample) => sample.label);
  const classes = new Set(trainLabels);
  if (classes.size < 2) {
    throw new Error(
      'Training labels contain a single class; logistic regression needs both classes.'
    );
  }

  const model = new LogisticRegression({ numSteps: 2000, learningRate: 0.1 });
  model.train(toMatrix(train, features), toLabels(train));

  const weights = model.classifiers[0].weights.to2DArray()[0];
  const trainPredictions = train.map((sample) => {
    const values = features.map((feature) => sample.features[feature] / 100);
    const logit = values.reduce((sum, value, index) => sum + value * weights[index], 0);
    return 1 / (1 + Math.exp(-logit)) >= 0.5 ? 1 : 0;
  });

  const evaluation = test.length
    ? (() => {
        const testPredictions = test.map((sample) => {
          const values = features.map((feature) => sample.features[feature] / 100);
          const logit = values.reduce(
            (sum, value, index) => sum + value * weights[index],
            0
          );
          return 1 / (1 + Math.exp(-logit)) >= 0.5 ? 1 : 0;
        });
        return metrics(test.map((sample) => sample.label), testPredictions);
      })()
    : null;

  return {
    model,
    weights,
    evaluation,
    trainMetrics: metrics(trainLabels, trainPredictions),
    train,
    test,
  };
}

async function calibrateReference() {
  const reference = loadReference();
  const manufacturers = await Manufacturer.find({}).lean();
  const rows = [];

  for (const entry of reference.manufacturers) {
    const target = normalizeName(entry.name);
    let manufacturer = manufacturers.find(
      (item) =>
        normalizeName(item.name) === target ||
        (item.aliases ?? []).some((alias) => normalizeName(alias) === target)
    );

    if (!manufacturer) {
      const match = fuzzyManufacturerMatch(entry.name, manufacturers, 0.6);
      manufacturer = match?.manufacturer ?? null;
    }

    if (!manufacturer) {
      rows.push({ name: entry.name, expected: entry.expectedScore, computed: null, delta: null });
      continue;
    }

    const result = await scoreManufacturer(manufacturer._id);
    rows.push({
      name: entry.name,
      expected: entry.expectedScore,
      computed: result.score,
      delta: Number((result.score - entry.expectedScore).toFixed(2)),
      expectedBand: entry.expectedBand,
      computedBand: result.band,
    });
  }

  return rows;
}

async function main() {
  await connectDB();
  const { samples, skippedColdStart, skippedNoCutoff } = await buildDataset();

  console.log('Risk model dataset:');
  console.log(`  samples:              ${samples.length}`);
  console.log(`  skipped (cold start): ${skippedColdStart}`);
  console.log(`  skipped (no cutoff):  ${skippedNoCutoff}`);
  console.log(`  positives:            ${samples.filter((s) => s.label === 1).length}`);

  if (samples.length === 0) {
    throw new Error('No labelled samples were produced. Ingest signals first.');
  }

  const features = Object.keys(samples[0].features);
  let trained;
  try {
    trained = trainModel(samples, features);
  } catch (error) {
    console.warn(`Training skipped: ${error.message}`);
    const fallback = {
      features,
      coefficients: features.map(() => 0),
      featureScale: 100,
      trainedAt: new Date().toISOString(),
      note: `Small-data limitation: ${error.message} The rule-based score remains the primary signal.`,
    };
    fs.writeFileSync(MODEL_PATH, JSON.stringify(fallback, null, 2));
    console.log(`Saved fallback model to ${MODEL_PATH}`);
    return;
  }

  const payload = {
    features,
    coefficients: trained.weights.map((value) => Number(value.toFixed(6))),
    featureScale: 100,
    trainedAt: new Date().toISOString(),
    trainSamples: trained.train.length,
    testSamples: trained.test.length,
    trainMetrics: trained.trainMetrics,
    testMetrics: trained.evaluation,
    note:
      'Small-data limitation: coefficients are trained on a small, time-split dataset and should be treated as directional, not clinical evidence. The rule-based score remains the primary signal.',
  };

  fs.writeFileSync(MODEL_PATH, JSON.stringify(payload, null, 2));

  console.log('Training complete:');
  console.log(`  features: ${features.join(', ')}`);
  console.log(`  train samples: ${trained.train.length}, test samples: ${trained.test.length}`);
  console.log(`  train metrics: ${JSON.stringify(trained.trainMetrics)}`);
  console.log(
    `  test metrics:  ${trained.evaluation ? JSON.stringify(trained.evaluation) : 'no held-out samples'}`
  );
  console.log(`  saved: ${MODEL_PATH}`);
  console.log('  limitation: small, synthetic-demo-scale data; use as directional only.');

  const rows = await calibrateReference();
  console.log('\nReference calibration:');
  for (const row of rows) {
    if (row.computed === null) {
      console.log(`  ${row.name}: not found in database (expected ${row.expected})`);
    } else {
      console.log(
        `  ${row.name}: expected ${row.expected} / computed ${row.computed} (delta ${row.delta}), band ${row.computedBand}`
      );
    }
  }
}

if (isMain(import.meta.url)) {
  main()
    .catch((error) => {
      console.error(`Risk model training failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await disconnectDB();
    });
}
