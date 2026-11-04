import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { bandFor, scoreManufacturer } from '../src/services/scoring.js';
import { loadWeights } from '../src/utils/config.js';

const weights = loadWeights();

function signal(type, severity, date, sourceName = 'CDSCO') {
  return {
    _id: new mongoose.Types.ObjectId(),
    type,
    severity,
    date: new Date(date),
    sourceName,
    sourceUrl: 'https://cdsco.gov.in',
    rawText: `${type} ${severity}`,
  };
}

function manufacturer(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    name: 'Test Pharma',
    regulatoryTier: 'Tier 2',
    createdAt: new Date('2020-01-01'),
    ...overrides,
  };
}

function products(count = 2) {
  return Array.from({ length: count }, (_, index) => ({
    _id: new mongoose.Types.ObjectId(),
    teCode: index === 0 ? 'AB' : null,
    createdAt: new Date('2021-01-01'),
  }));
}

describe('scoring', () => {
  it('uses a non-penalising baseline for sparse manufacturers', async () => {
    const result = await scoreManufacturer(manufacturer(), {
      products: products(1),
      signals: [],
      now: new Date('2026-10-01'),
      weights,
    });

    expect(result.band).toBe('LimitedData');
    expect(result.coldStart).toBe(true);
    expect(result.score).toBe(weights.baseline.regulatoryTier['Tier 2']);
    expect(result.factors).toHaveLength(6);
    for (const factor of result.factors) {
      expect(factor.evidence).toEqual([]);
      expect(factor.value).toBe(weights.baseline.regulatoryTier['Tier 2']);
    }
  });

  it('returns a transparent weighted sum with evidence', async () => {
    const nsq = signal('NSQ', 'HIGH', '2026-06-01');
    const recall = signal('RECALL', 'HIGH', '2026-05-01');
    const approval = signal('APPROVAL', 'LOW', '2025-12-01');
    const result = await scoreManufacturer(manufacturer(), {
      products: products(3),
      signals: [nsq, recall, approval],
      now: new Date('2026-10-01'),
      weights,
    });

    expect(result.coldStart).toBe(false);
    expect(['High', 'Moderate', 'Low']).toContain(result.band);

    const weightSum = result.factors.reduce(
      (sum, factor) => sum + factor.weight,
      0
    );
    const contributionSum = result.factors.reduce(
      (sum, factor) => sum + factor.contribution,
      0
    );
    expect(weightSum).toBeCloseTo(1, 5);
    expect(contributionSum).toBeCloseTo(result.score, 2);

    const nsqFactor = result.factors.find((factor) => factor.name === 'recentNsq');
    const recallFactor = result.factors.find(
      (factor) => factor.name === 'recallHistory'
    );
    expect(nsqFactor.value).toBeLessThan(100);
    expect(recallFactor.value).toBeLessThan(100);
    expect(nsqFactor.evidence.map(String)).toContain(String(nsq._id));
    expect(recallFactor.evidence.map(String)).toContain(String(recall._id));

    for (const factor of result.factors) {
      expect(factor.source.sourceName).toBeTruthy();
      expect(factor.source.sourceUrl).toMatch(/^https?:\/\//);
      expect(factor.source.sourceDate).toBeInstanceOf(Date);
    }
  });

  it('time-decays old recalls less than recent recalls', async () => {
    const oldRecall = signal('RECALL', 'HIGH', '2020-01-01');
    const recentRecall = signal('RECALL', 'HIGH', '2026-09-01');
    const approval = signal('APPROVAL', 'LOW', '2020-02-01');

    const oldResult = await scoreManufacturer(manufacturer(), {
      products: products(3),
      signals: [oldRecall, approval],
      now: new Date('2026-10-01'),
      weights,
    });
    const recentResult = await scoreManufacturer(manufacturer(), {
      products: products(3),
      signals: [recentRecall, approval],
      now: new Date('2026-10-01'),
      weights,
    });

    const oldFactor = oldResult.factors.find(
      (factor) => factor.name === 'recallHistory'
    );
    const recentFactor = recentResult.factors.find(
      (factor) => factor.name === 'recallHistory'
    );
    expect(oldFactor.value).toBeGreaterThan(recentFactor.value);
  });

  it('maps scores to the expected bands', () => {
    expect(bandFor(80, weights)).toBe('High');
    expect(bandFor(79.99, weights)).toBe('Moderate');
    expect(bandFor(60, weights)).toBe('Moderate');
    expect(bandFor(59.99, weights)).toBe('Low');
  });
});
