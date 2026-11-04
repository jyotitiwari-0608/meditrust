import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CONFIG_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../config'
);

const MODEL_PATH = path.join(CONFIG_DIR, 'riskModel.json');

export function loadRiskModel(filePath = MODEL_PATH) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function factorVector(factorValues, features) {
  return features.map((feature) => {
    const value = Array.isArray(factorValues)
      ? factorValues[features.indexOf(feature)]
      : factorValues[feature];
    return Number(value) || 0;
  });
}

export function explainRiskModel(factorValues, model) {
  if (!model) return null;

  const values = factorVector(factorValues, model.features);
  const contributions = model.features.map((feature, index) => ({
    feature,
    coefficient: model.coefficients[index],
    value: values[index],
    contribution: Number(
      (model.coefficients[index] * (values[index] / 100)).toFixed(4)
    ),
  }));

  const logit = contributions.reduce(
    (sum, item) => sum + item.contribution,
    0
  );

  return {
    probability: Number(sigmoid(logit).toFixed(4)),
    logit: Number(logit.toFixed(4)),
    contributions,
  };
}

export function predictRiskProbability(factorValues, model) {
  const explanation = explainRiskModel(factorValues, model);
  return explanation ? explanation.probability : null;
}

export function blendScores(ruleScore, probability, alpha = 0.3) {
  if (probability === null || probability === undefined) {
    return {
      score: ruleScore,
      ruleScore,
      modelProbability: null,
      alpha: 0,
    };
  }

  const weight = Math.min(1, Math.max(0, alpha));
  const blended = (1 - weight) * ruleScore + weight * probability * 100;

  return {
    score: Number(blended.toFixed(2)),
    ruleScore,
    modelProbability: probability,
    alpha: weight,
  };
}

export function blendedScoreWithExplanation(ruleScore, factorValues, model, alpha = 0.3) {
  const explanation = explainRiskModel(factorValues, model);
  const probability = explanation?.probability ?? null;
  return {
    ...blendScores(ruleScore, probability, alpha),
    explanation,
  };
}
