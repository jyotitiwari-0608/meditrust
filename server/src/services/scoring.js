import mongoose from 'mongoose';
import { Manufacturer, Product, Score, Signal } from '../models/index.js';
import { loadWeights } from '../utils/config.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const FACTOR_LABELS = {
  regulatoryApproval: 'Regulatory approval / TE code coverage',
  recentNsq: 'Recent NSQ alerts',
  recallHistory: 'Recall history (severity-weighted, time-decayed)',
  marketPresence: 'Years of market presence',
  approvedProducts: 'Number of approved products',
  regulatoryTier: 'Country regulatory tier',
};

const SEVERITY_POINTS = {
  LOW: 0.5,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

const METHODOLOGY_SOURCE = {
  sourceName: 'MediTrust scoring methodology v1',
  sourceUrl:
    process.env.SCORING_METHODOLOGY_URL ??
    'https://example.org/meditrust/methodology',
  sourceDate: new Date(process.env.SCORING_METHODOLOGY_DATE ?? '2026-01-01'),
};

function round2(value) {
  return Number(Number(value).toFixed(2));
}

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

export function bandFor(score, weights = loadWeights()) {
  if (score >= weights.bands.high) return 'High';
  if (score >= weights.bands.moderate) return 'Moderate';
  return 'Low';
}

function sourceFromSignals(signals) {
  const latest = [...signals].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  )[0];

  if (!latest) return METHODOLOGY_SOURCE;

  return {
    sourceName: latest.sourceName,
    sourceUrl: latest.sourceUrl,
    sourceDate: new Date(latest.date),
  };
}

function factor(name, value, weight, evidenceSignals = [], note) {
  const roundedValue = round2(clamp(value));
  return {
    name,
    label: FACTOR_LABELS[name],
    value: roundedValue,
    weight,
    contribution: round2(weight * roundedValue),
    evidence: evidenceSignals.map((signal) => signal._id),
    source: sourceFromSignals(evidenceSignals),
    ...(note ? { note } : {}),
  };
}

function baselineScore(manufacturer, weights, now) {
  const baseline =
    weights.baseline.regulatoryTier[manufacturer.regulatoryTier] ??
    weights.baseline.regulatoryTier.Unrated;

  const factors = Object.entries(weights.factors).map(([name, weight]) =>
    factor(name, baseline, weight, [], 'Cold-start baseline; missing data is not penalised.')
  );

  const score = round2(
    factors.reduce((sum, item) => sum + item.contribution, 0)
  );

  return {
    score,
    band: 'LimitedData',
    factors,
    coldStart: true,
    limitedData: true,
    manufacturer: {
      id: String(manufacturer._id),
      name: manufacturer.name,
      regulatoryTier: manufacturer.regulatoryTier,
    },
    computedAt: now.toISOString(),
  };
}

async function resolveManufacturer(manufacturerOrId) {
  if (manufacturerOrId instanceof mongoose.Types.ObjectId) {
    return Manufacturer.findById(manufacturerOrId).lean();
  }

  if (typeof manufacturerOrId === 'string') {
    return Manufacturer.findById(manufacturerOrId).lean();
  }

  if (manufacturerOrId && manufacturerOrId._id) {
    return manufacturerOrId;
  }

  if (manufacturerOrId && manufacturerOrId.id) {
    return Manufacturer.findById(manufacturerOrId.id).lean();
  }

  return null;
}

export async function scoreManufacturer(manufacturerOrId, options = {}) {
  const weights = options.weights ?? loadWeights();
  const now = options.now ? new Date(options.now) : new Date();
  const manufacturer = await resolveManufacturer(manufacturerOrId);

  if (!manufacturer) {
    throw new Error('Manufacturer not found for scoring.');
  }

  const products =
    options.products ??
    (await Product.find({ manufacturer: manufacturer._id }).lean());

  const productIds = products.map((product) => product._id);
  const signals =
    options.signals ??
    (await Signal.find({
      $or: [
        { manufacturer: manufacturer._id },
        { product: { $in: productIds } },
      ],
    }).lean());

  if (
    products.length < weights.coldStart.minProducts ||
    signals.length < weights.coldStart.minSignals
  ) {
    return baselineScore(manufacturer, weights, now);
  }

  const approvalSignals = signals.filter(
    (signal) => signal.type === 'APPROVAL'
  );
  const nsqCutoff = new Date(
    now.getTime() - weights.recentNsqMonths * 30 * DAY_MS
  );
  const recentNsq = signals.filter(
    (signal) =>
      signal.type === 'NSQ' && new Date(signal.date).getTime() >= nsqCutoff.getTime()
  );
  const recalls = signals.filter((signal) => signal.type === 'RECALL');

  const approvedProducts = products.filter((product) => product.teCode).length;
  const approvalCoverage = products.length
    ? (approvedProducts / products.length) * 100
    : 70;

  const nsqPenalty = recentNsq.reduce(
    (sum, signal) => sum + (SEVERITY_POINTS[signal.severity] ?? 1),
    0
  );
  const recentNsqValue = clamp(100 - nsqPenalty * 20);

  const recallPenalty = recalls.reduce((sum, signal) => {
    const ageDays = Math.max(
      0,
      (now.getTime() - new Date(signal.date).getTime()) / DAY_MS
    );
    const decay = 0.5 ** (ageDays / weights.recallHalfLifeDays);
    const points = SEVERITY_POINTS[signal.severity] ?? 1;
    return sum + points * decay;
  }, 0);
  const recallValue = clamp(100 - recallPenalty * 15);

  const dates = [
    manufacturer.createdAt,
    ...products.map((product) => product.createdAt),
    ...signals.map((signal) => signal.date),
  ]
    .filter(Boolean)
    .map((date) => new Date(date).getTime())
    .filter((time) => Number.isFinite(time));

  const earliest = dates.length ? Math.min(...dates) : null;
  const years = earliest ? (now.getTime() - earliest) / (365.25 * DAY_MS) : null;
  const marketPresenceValue =
    years === null ? 60 : clamp(50 + Math.max(0, years) * 5);

  const approvedProductsValue = clamp(25 + approvedProducts * 15);
  const tierValue =
    weights.baseline.regulatoryTier[manufacturer.regulatoryTier] ??
    weights.baseline.regulatoryTier.Unrated;

  const factorEntries = {
    regulatoryApproval: factor(
      'regulatoryApproval',
      approvalCoverage,
      weights.factors.regulatoryApproval,
      approvalSignals
    ),
    recentNsq: factor(
      'recentNsq',
      recentNsqValue,
      weights.factors.recentNsq,
      recentNsq
    ),
    recallHistory: factor(
      'recallHistory',
      recallValue,
      weights.factors.recallHistory,
      recalls
    ),
    marketPresence: factor(
      'marketPresence',
      marketPresenceValue,
      weights.factors.marketPresence,
      approvalSignals.slice(0, 1),
      years === null ? 'No market-presence date available; neutral value used.' : undefined
    ),
    approvedProducts: factor(
      'approvedProducts',
      approvedProductsValue,
      weights.factors.approvedProducts,
      approvalSignals
    ),
    regulatoryTier: factor(
      'regulatoryTier',
      tierValue,
      weights.factors.regulatoryTier,
      [],
      'Regulatory tier is used as a neutral baseline, not as a penalty.'
    ),
  };

  const factors = Object.keys(weights.factors).map((name) => factorEntries[name]);
  const score = round2(
    factors.reduce((sum, item) => sum + item.contribution, 0)
  );

  return {
    score,
    band: bandFor(score, weights),
    factors,
    coldStart: false,
    limitedData: false,
    manufacturer: {
      id: String(manufacturer._id),
      name: manufacturer.name,
      regulatoryTier: manufacturer.regulatoryTier,
    },
    computedAt: now.toISOString(),
  };
}

export async function saveScoreForProduct(productOrId, options = {}) {
  const product =
    typeof productOrId === 'string' || productOrId instanceof mongoose.Types.ObjectId
      ? await Product.findById(productOrId).lean()
      : productOrId;

  if (!product) throw new Error('Product not found for scoring.');

  const result = await scoreManufacturer(product.manufacturer, options);

  const score = await Score.create({
    product: product._id,
    value: result.score,
    band: result.band,
    factors: result.factors.map((item) => ({
      key: item.name,
      label: item.label,
      weight: item.weight,
      value: item.value,
      contribution: item.contribution,
      source: item.source,
      evidence: item.evidence,
    })),
    computedAt: new Date(result.computedAt),
    version: 'v1',
  });

  return { result, score };
}
