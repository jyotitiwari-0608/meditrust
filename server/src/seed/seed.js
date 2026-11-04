import 'dotenv/config';
import { connectDB, disconnectDB } from '../config/db.js';
import {
  Drug,
  Brand,
  Manufacturer,
  Product,
  Signal,
  Score,
  Extraction,
} from '../models/index.js';

const SOURCE = {
  nppa: {
    sourceName: 'National Pharmaceutical Pricing Authority (NPPA)',
    sourceUrl: 'https://nppa.gov.in',
    sourceDate: new Date('2026-01-15'),
  },
  cdsco: {
    sourceName: 'Central Drugs Standard Control Organisation (CDSCO)',
    sourceUrl: 'https://cdsco.gov.in',
    sourceDate: new Date('2026-02-10'),
  },
  cdscoInspection: {
    sourceName: 'CDSCO Inspections',
    sourceUrl: 'https://cdsco.gov.in/opencms/opencms/en/Inspections/',
    sourceDate: new Date('2026-01-20'),
  },
  methodology: {
    sourceName: 'MediTrust scoring methodology v1',
    sourceUrl: 'https://example.org/meditrust/methodology',
    sourceDate: new Date('2026-01-01'),
  },
};

function makeFactor(key, label, weight, value, source, evidence = []) {
  return {
    key,
    label,
    weight,
    value,
    contribution: Number((weight * value).toFixed(2)),
    source,
    evidence,
  };
}

function bandFor(value) {
  if (value >= 80) return 'High';
  if (value >= 60) return 'Moderate';
  return 'Low';
}

function makeScore(product, values, version = 'v1') {
  const factors = [
    makeFactor(
      'qualitySignals',
      'Quality signals (NSQ/recall history)',
      0.4,
      values.qualitySignals,
      SOURCE.cdsco
    ),
    makeFactor(
      'regulatoryCompliance',
      'Regulatory compliance and approvals',
      0.3,
      values.regulatoryCompliance,
      SOURCE.cdsco
    ),
    makeFactor(
      'manufacturingAudit',
      'Manufacturing audit outcomes',
      0.2,
      values.manufacturingAudit,
      SOURCE.cdscoInspection
    ),
    makeFactor(
      'dataCompleteness',
      'Data completeness',
      0.1,
      values.dataCompleteness,
      SOURCE.methodology
    ),
  ];

  const value = Number(
    factors.reduce((sum, factor) => sum + factor.contribution, 0).toFixed(2)
  );

  return {
    product: product._id,
    value,
    band: bandFor(value),
    factors,
    version,
  };
}

async function seed() {
  await connectDB();
  console.log('Clearing existing MediTrust collections...');

  await Promise.all([
    Extraction.deleteMany({}),
    Score.deleteMany({}),
    Signal.deleteMany({}),
    Product.deleteMany({}),
    Brand.deleteMany({}),
    Drug.deleteMany({}),
    Manufacturer.deleteMany({}),
  ]);

  const [cipla, sun, acme] = await Manufacturer.create([
    {
      name: 'Cipla Ltd',
      aliases: ['Cipla'],
      country: 'India',
      regulatoryTier: 'Tier 1',
    },
    {
      name: 'Sun Pharmaceutical Industries Ltd',
      aliases: ['Sun Pharma'],
      country: 'India',
      regulatoryTier: 'Tier 1',
    },
    {
      name: 'Acme Generics Pvt Ltd',
      aliases: [],
      country: 'India',
      regulatoryTier: 'Tier 3',
    },
  ]);

  const [paracetamol, metformin, amoxicillin] = await Drug.create([
    {
      salt: 'Paracetamol',
      strength: '500 mg',
      form: 'Tablet',
      atcCode: 'N02BE01',
    },
    {
      salt: 'Metformin Hydrochloride',
      strength: '500 mg',
      form: 'Tablet',
      atcCode: 'A10BA02',
    },
    {
      salt: 'Amoxicillin',
      strength: '500 mg',
      form: 'Capsule',
      atcCode: 'J01CA04',
    },
  ]);

  const [paracip, calpol, glycomet, mox, acmePara] = await Brand.create([
    {
      name: 'Paracip 500',
      manufacturer: cipla._id,
      drug: paracetamol._id,
      source: SOURCE.nppa,
    },
    {
      name: 'Calpol 500',
      manufacturer: sun._id,
      drug: paracetamol._id,
      source: SOURCE.nppa,
    },
    {
      name: 'Glycomet 500',
      manufacturer: sun._id,
      drug: metformin._id,
      source: SOURCE.nppa,
    },
    {
      name: 'Mox 500',
      manufacturer: cipla._id,
      drug: amoxicillin._id,
      source: SOURCE.nppa,
    },
    {
      name: 'Acme Paracetamol 500',
      manufacturer: acme._id,
      drug: paracetamol._id,
      source: SOURCE.cdsco,
    },
  ]);

  const [paracipProduct, calpolProduct, glycometProduct, moxProduct, acmeProduct] =
    await Product.create([
      {
        drug: paracetamol._id,
        manufacturer: cipla._id,
        brand: paracip._id,
        mrp: 22.5,
        teCode: 'PARA500-CIP-10',
        source: SOURCE.nppa,
      },
      {
        drug: paracetamol._id,
        manufacturer: sun._id,
        brand: calpol._id,
        mrp: 31,
        teCode: 'PARA500-SUN-15',
        source: SOURCE.nppa,
      },
      {
        drug: metformin._id,
        manufacturer: sun._id,
        brand: glycomet._id,
        mrp: 18.75,
        teCode: 'MET500-SUN-20',
        source: SOURCE.nppa,
      },
      {
        drug: amoxicillin._id,
        manufacturer: cipla._id,
        brand: mox._id,
        mrp: 85,
        teCode: 'AMOX500-CIP-10',
        source: SOURCE.nppa,
      },
      {
        drug: paracetamol._id,
        manufacturer: acme._id,
        brand: acmePara._id,
        mrp: 12,
        teCode: 'PARA500-ACM-10',
        source: SOURCE.cdsco,
      },
    ]);

  const [nsqSignal, recallSignal, inspectionSignal, approvalSignal] =
    await Signal.create([
      {
        product: acmeProduct._id,
        manufacturer: acme._id,
        type: 'NSQ',
        date: new Date('2026-02-10'),
        severity: 'HIGH',
        sourceName: SOURCE.cdsco.sourceName,
        sourceUrl: SOURCE.cdsco.sourceUrl,
        rawText:
          'Batch ACME-PARA-0924 of Paracetamol 500 mg tablets was declared not of standard quality after assay failure.',
      },
      {
        product: calpolProduct._id,
        manufacturer: sun._id,
        type: 'RECALL',
        date: new Date('2026-03-01'),
        severity: 'MEDIUM',
        sourceName: SOURCE.cdsco.sourceName,
        sourceUrl: SOURCE.cdsco.sourceUrl,
        rawText:
          'Voluntary recall of a single batch due to a labelling discrepancy; no safety impact reported.',
      },
      {
        manufacturer: acme._id,
        type: 'INSPECTION',
        date: new Date('2026-01-20'),
        severity: 'HIGH',
        sourceName: SOURCE.cdscoInspection.sourceName,
        sourceUrl: SOURCE.cdscoInspection.sourceUrl,
        rawText:
          'Inspection observed deficiencies in documentation and equipment calibration records.',
      },
      {
        manufacturer: cipla._id,
        type: 'APPROVAL',
        date: new Date('2025-11-05'),
        severity: 'LOW',
        sourceName: SOURCE.cdsco.sourceName,
        sourceUrl: SOURCE.cdsco.sourceUrl,
        rawText:
          'Renewal of manufacturing licence approved for the listed oral solid dosage facility.',
      },
    ]);

  await Score.create([
    makeScore(paracipProduct, {
      qualitySignals: 92,
      regulatoryCompliance: 88,
      manufacturingAudit: 85,
      dataCompleteness: 90,
    }),
    makeScore(calpolProduct, {
      qualitySignals: 85,
      regulatoryCompliance: 90,
      manufacturingAudit: 88,
      dataCompleteness: 95,
    }),
    makeScore(glycometProduct, {
      qualitySignals: 86,
      regulatoryCompliance: 90,
      manufacturingAudit: 88,
      dataCompleteness: 95,
    }),
    makeScore(moxProduct, {
      qualitySignals: 88,
      regulatoryCompliance: 88,
      manufacturingAudit: 85,
      dataCompleteness: 90,
    }),
  ]);

  await Extraction.create([
    {
      signal: nsqSignal._id,
      json: {
        summary:
          'CDSCO declared batch ACME-PARA-0924 not of standard quality due to assay failure.',
        signalType: 'NSQ',
        product: 'Paracetamol 500 mg tablet',
        confidence: 0.84,
      },
      confidence: 0.84,
      needsReview: false,
    },
    {
      signal: recallSignal._id,
      json: {
        summary:
          'Single-batch voluntary recall for a labelling discrepancy with no reported safety impact.',
        signalType: 'RECALL',
        product: 'Calpol 500',
        confidence: 0.76,
      },
      confidence: 0.76,
      needsReview: false,
    },
    {
      signal: inspectionSignal._id,
      json: {
        summary:
          'Inspection found documentation and calibration deficiencies at the Acme Generics facility.',
        signalType: 'INSPECTION',
        manufacturer: 'Acme Generics Pvt Ltd',
        confidence: 0.41,
      },
      confidence: 0.41,
      needsReview: false,
    },
    {
      signal: approvalSignal._id,
      json: {
        summary:
          'Cipla oral solid dosage facility manufacturing licence renewal approved.',
        signalType: 'APPROVAL',
        manufacturer: 'Cipla Ltd',
        confidence: 0.91,
      },
      confidence: 0.91,
      needsReview: false,
    },
  ]);

  await Promise.all([
    Drug.init(),
    Brand.init(),
    Manufacturer.init(),
    Product.init(),
    Signal.init(),
    Score.init(),
    Extraction.init(),
  ]);

  const reviewCount = await Extraction.countDocuments({ needsReview: true });
  console.log('Seed complete:');
  console.log(`  manufacturers: ${await Manufacturer.countDocuments()}`);
  console.log(`  drugs:         ${await Drug.countDocuments()}`);
  console.log(`  brands:        ${await Brand.countDocuments()}`);
  console.log(`  products:      ${await Product.countDocuments()}`);
  console.log(`  signals:       ${await Signal.countDocuments()}`);
  console.log(`  scores:        ${await Score.countDocuments()}`);
  console.log(
    `  extractions:   ${await Extraction.countDocuments()} (${reviewCount} needsReview)`
  );
  console.log(
    'Note: Acme Generics has sparse data and intentionally has no score yet; cold-start scoring is a later feature.'
  );
}

seed()
  .catch((error) => {
    console.error(`Seed failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDB();
  });
