import { describe, expect, it } from 'vitest';
import {
  normalizeForm,
  normalizeName,
  normalizeSalt,
  normalizeStrength,
} from '../src/utils/normalize.js';
import {
  parseComposition,
  parseForm,
  parsePrice,
  parseStrength,
  splitNsqRows,
} from '../src/utils/parsers.js';
import { fuzzyManufacturerMatch } from '../src/utils/fuzzy.js';

describe('ingestion utilities', () => {
  it('normalizes manufacturer names', () => {
    expect(normalizeName('Sun Pharmaceutical Industries Ltd')).toBe('sun');
    expect(normalizeName('Cipla Ltd.')).toBe('cipla');
    expect(normalizeName('Dr. Reddy\u2019s Laboratories Ltd')).toBe('dr reddys');
  });

  it('normalizes salts, strengths and forms', () => {
    expect(normalizeSalt('Metformin Hydrochloride')).toBe('metformin');
    expect(normalizeSalt('Amlodipine Besylate')).toBe('amlodipine');
    expect(normalizeStrength('500MG')).toBe('500mg');
    expect(normalForm('TABLET')).toBe('tablet');
  });

  it('parses composition into salt, strength and form', () => {
    expect(parseComposition('Paracetamol 500 mg Tablet')).toMatchObject({
      salt: 'Paracetamol',
      atcCode: 'N02BE01',
      strength: '500 mg',
      form: 'Tablet',
    });
    expect(parseComposition('Metformin Hydrochloride 500mg Tablet')).toMatchObject({
      salt: 'Metformin Hydrochloride',
      strength: '500 mg',
      form: 'Tablet',
    });
    expect(parseComposition('Random Drug 10 mg Tablet')).toBeNull();
  });

  it('parses strengths, forms and prices', () => {
    expect(parseStrength('Amoxicillin 250 mg Capsule')).toBe('250 mg');
    expect(parseForm('Capsule')).toBe('Capsule');
    expect(parsePrice('\u20b9 22.50')).toBe(22.5);
    expect(parsePrice('Rs. 1,250.00')).toBe(1250);
    expect(parsePrice('n/a')).toBeNull();
  });

  it('fuzzy matches manufacturers', () => {
    const manufacturers = [
      { _id: '1', name: 'Acme Generics Pvt Ltd', aliases: [] },
      { _id: '2', name: 'Cipla Ltd', aliases: ['Cipla'] },
    ];

    expect(fuzzyManufacturerMatch('Acme Generics', manufacturers)?.manufacturer._id).toBe('1');
    expect(fuzzyManufacturerMatch('Cipla', manufacturers)?.manufacturer._id).toBe('2');
    expect(fuzzyManufacturerMatch('Totally Unknown', manufacturers)).toBeNull();
  });

  it('splits CDSCO NSQ text into rows', () => {
    const text = [
      'Drug Name: Paracetamol 500 mg Tablet',
      'Batch No: ABC123',
      'Manufacturer: Acme Generics Pvt Ltd',
      'Reason: Assay failure',
      '',
      'Drug Name: Metformin 500 mg Tablet',
      'Batch No: XYZ789',
      'Manufacturer: Cipla Ltd',
      'Reason: Dissolution failure',
    ].join('\n');

    const rows = splitNsqRows(text);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      drug: 'Paracetamol 500 mg Tablet',
      batch: 'ABC123',
      manufacturer: 'Acme Generics Pvt Ltd',
      reason: 'Assay failure',
    });
    expect(rows[1].batch).toBe('XYZ789');
  });
});
