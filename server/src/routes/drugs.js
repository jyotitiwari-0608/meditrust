import { Router } from 'express';
import { z } from 'zod';
import { Drug, Product, Score } from '../models/index.js';
import { asyncHandler, zodDetails } from '../utils/http.js';

const router = Router();

const paramsSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid drug id'),
});

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  referenceProductId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, 'Invalid reference product id')
    .optional(),
  referenceBrandId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, 'Invalid reference brand id')
    .optional(),
});

function scoreSummary(score) {
  if (!score) return null;
  return {
    value: score.value,
    band: score.band,
    computedAt: score.computedAt,
    version: score.version,
    provenance: score.factors?.[0]?.source ?? null,
  };
}

router.get(
  '/:id/equivalents',
  asyncHandler(async (req, res) => {
    const params = paramsSchema.safeParse(req.params);
    if (!params.success) {
      return res.status(400).json({
        error: 'Invalid drug id',
        details: zodDetails(params.error),
      });
    }

    const query = querySchema.safeParse(req.query);
    if (!query.success) {
      return res.status(400).json({
        error: 'Invalid query',
        details: zodDetails(query.error),
      });
    }

    const { page, limit, referenceProductId, referenceBrandId } = query.data;

    const drug = await Drug.findById(params.data.id).lean();
    if (!drug) {
      return res.status(404).json({ error: 'Drug not found' });
    }

    const products = await Product.find({ drug: drug._id })
      .populate('manufacturer brand')
      .lean();

    if (products.length === 0) {
      return res.json({
        drug,
        reference: null,
        page,
        limit,
        total: 0,
        results: [],
        message: 'No products found for this drug.',
      });
    }

    let reference = null;
    if (referenceProductId) {
      reference = products.find(
        (product) => String(product._id) === referenceProductId
      );
    } else if (referenceBrandId) {
      reference = products.find(
        (product) => String(product.brand?._id) === referenceBrandId
      );
    }

    if (!reference) {
      reference = [...products].sort((a, b) => b.mrp - a.mrp)[0];
    }

    const productIds = products.map((product) => product._id);
    const scores = await Score.find({ product: { $in: productIds } })
      .sort({ computedAt: -1 })
      .lean();
    const latestScore = new Map();
    for (const score of scores) {
      const key = String(score.product);
      if (!latestScore.has(key)) latestScore.set(key, score);
    }

    const results = products
      .map((product) => {
        const score = latestScore.get(String(product._id));
        const savings = reference ? reference.mrp - product.mrp : null;
        const savingsPercent =
          reference && reference.mrp > 0
            ? Number(((savings / reference.mrp) * 100).toFixed(1))
            : null;

        return {
          productId: String(product._id),
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
          price: product.mrp,
          teCode: product.teCode ?? null,
          savings,
          savingsPercent,
          score: scoreSummary(score),
          band: score?.band ?? 'LimitedData',
          limitedData: !score || score.band === 'LimitedData',
          provenance: product.source,
          scoreProvenance: score?.factors?.[0]?.source ?? null,
        };
      })
      .sort((a, b) => {
        const aScore = a.score?.value ?? -1;
        const bScore = b.score?.value ?? -1;
        if (bScore !== aScore) return bScore - aScore;
        return (a.price ?? 0) - (b.price ?? 0);
      });

    const total = results.length;
    const start = (page - 1) * limit;
    const pageResults = results.slice(start, start + limit);

    return res.json({
      drug,
      reference: reference
        ? {
            productId: String(reference._id),
            brand: reference.brand
              ? { id: String(reference.brand._id), name: reference.brand.name }
              : null,
            price: reference.mrp,
            autoSelected: !referenceProductId && !referenceBrandId,
          }
        : null,
      page,
      limit,
      total,
      results: pageResults,
      message:
        pageResults.length === 0
          ? 'No more results for this drug.'
          : undefined,
    });
  })
);

export default router;
