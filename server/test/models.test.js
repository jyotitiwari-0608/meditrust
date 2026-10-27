import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import {
  Drug,
  Product,
  Signal,
  Score,
  Extraction,
} from '../src/models/index.js';

const provenance = {
  sourceName: 'CDSCO',
  sourceUrl: 'https://cdsco.gov.in',
  sourceDate: new Date('2026-02-10'),
};

async function validationError(promise) {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

describe('models', () => {
  it('requires drug identity fields and uppercases ATC codes', () => {
    const valid = new Drug({
      salt: 'Paracetamol',
      strength: '500 mg',
      form: 'Tablet',
      atcCode: 'n02be01',
    });
    expect(valid.validateSync()).toBeUndefined();
    expect(valid.atcCode).toBe('N02BE01');

    const invalid = new Drug({ strength: '500 mg', form: 'Tablet' });
    const error = invalid.validateSync();
    expect(error.errors.salt).toBeTruthy();
    expect(error.errors.atcCode).toBeTruthy();
  });

  it('requires complete provenance on products', () => {
    const base = {
      drug: new mongoose.Types.ObjectId(),
      manufacturer: new mongoose.Types.ObjectId(),
      mrp: 22.5,
      teCode: 'PARA500-CIP-10',
    };

    const missingSource = new Product(base);
    expect(missingSource.validateSync().errors.source).toBeTruthy();

    const partialSource = new Product({
      ...base,
      source: { sourceName: 'NPPA', sourceDate: new Date('2026-01-15') },
    });
    expect(
      partialSource.validateSync().errors['source.sourceUrl']
    ).toBeTruthy();

    const valid = new Product({ ...base, source: provenance });
    expect(valid.validateSync()).toBeUndefined();
  });

  it('requires a signal subject', async () => {
    const base = {
      type: 'NSQ',
      date: new Date('2026-02-10'),
      sourceName: 'CDSCO',
      sourceUrl: 'https://cdsco.gov.in',
    };

    const orphan = new Signal(base);
    const error = await validationError(orphan.validate());
    expect(error.errors.product).toBeTruthy();

    const linked = new Signal({
      ...base,
      manufacturer: new mongoose.Types.ObjectId(),
    });
    expect(await validationError(linked.validate())).toBeNull();
  });

  it('enforces the weighted score sum', async () => {
    const factor = (key, weight, value) => ({
      key,
      label: key,
      weight,
      value,
      contribution: Number((weight * value).toFixed(2)),
      source: provenance,
    });

    const base = {
      product: new mongoose.Types.ObjectId(),
      factors: [factor('quality', 0.6, 90), factor('audit', 0.4, 75)],
    };

    const valid = new Score({ ...base, value: 84, band: 'High' });
    expect(await validationError(valid.validate())).toBeNull();

    const wrongValue = new Score({ ...base, value: 90, band: 'High' });
    expect((await validationError(wrongValue.validate())).errors.value).toBeTruthy();

    const wrongWeights = new Score({
      product: base.product,
      value: 80,
      band: 'High',
      factors: [factor('quality', 0.5, 90), factor('audit', 0.4, 80)],
    });
    expect(
      (await validationError(wrongWeights.validate())).errors.factors
    ).toBeTruthy();
  });

  it('flags low-confidence extractions for review', async () => {
    const signalId = new mongoose.Types.ObjectId();

    const low = new Extraction({
      signal: signalId,
      json: { summary: 'Uncertain extraction' },
      confidence: 0.41,
      needsReview: false,
    });
    await low.validate();
    expect(low.needsReview).toBe(true);

    const high = new Extraction({
      signal: signalId,
      json: { summary: 'Confident extraction' },
      confidence: 0.91,
      needsReview: false,
    });
    await high.validate();
    expect(high.needsReview).toBe(false);
  });
});
