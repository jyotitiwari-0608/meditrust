import { Router } from 'express';
import { z } from 'zod';
import { Product, Score } from '../models/index.js';
import { asyncHandler, zodDetails } from '../utils/http.js';

const router = Router();

const paramsSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid product id'),
});

router.get(
  '/:id/evidence',
  asyncHandler(async (req, res) => {
    const params = paramsSchema.safeParse(req.params);
    if (!params.success) {
      return res.status(400).json({
        error: 'Invalid product id',
        details: zodDetails(params.error),
      });
    }

    const product = await Product.findById(params.data.id)
      .populate('drug manufacturer brand')
      .lean();

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const score = await Score.findOne({ product: product._id })
      .sort({ computedAt: -1 })
      .populate({
        path: 'factors.evidence',
        select: 'type date severity sourceName sourceUrl rawText',
      })
      .lean();

    const productSummary = {
      id: String(product._id),
      brand: product.brand
        ? { id: String(product.brand._id), name: product.brand.name }
        : null,
      manufacturer: product.manufacturer
        ? {
            id: String(product.manufacturer._id),
            name: product.manufacturer.name,
            country: product.manufacturer.country,
            regulatoryTier: product.manufacturer.regulatoryTier,
          }
        : null,
      drug: product.drug
        ? {
            id: String(product.drug._id),
            salt: product.drug.salt,
            strength: product.drug.strength,
            form: product.drug.form,
            atcCode: product.drug.atcCode,
          }
        : null,
      price: product.mrp,
      teCode: product.teCode ?? null,
      provenance: product.source,
    };

    if (!score) {
      return res.json({
        product: productSummary,
        score: null,
        band: 'LimitedData',
        limitedData: true,
        message: 'No score data is available for this product yet.',
        disclaimer:
          'Decision-support only. This system never prescribes; confirm any substitution with a qualified clinician.',
      });
    }

    return res.json({
      product: productSummary,
      score: {
        value: score.value,
        band: score.band,
        computedAt: score.computedAt,
        version: score.version,
        factors: score.factors.map((factor) => ({
          key: factor.key,
          label: factor.label,
          weight: factor.weight,
          value: factor.value,
          contribution: factor.contribution,
          source: factor.source,
          evidence: (factor.evidence ?? []).map((signal) => ({
            id: String(signal._id),
            type: signal.type,
            date: signal.date,
            severity: signal.severity,
            sourceName: signal.sourceName,
            sourceUrl: signal.sourceUrl,
            rawText: signal.rawText,
          })),
        })),
      },
      band: score.band,
      limitedData: score.band === 'LimitedData',
      disclaimer:
        'Decision-support only. This system never prescribes; confirm any substitution with a qualified clinician.',
    });
  })
);

export default router;
