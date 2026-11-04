import { Router } from 'express';
import { z } from 'zod';
import { Brand, Drug, Product, Score } from '../models/index.js';
import { fuzzySearch } from '../utils/fuzzy.js';
import { asyncHandler, zodDetails } from '../utils/http.js';

const router = Router();

const querySchema = z.object({
  q: z.string().trim().min(1, 'q is required').max(120),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
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

function resultFromProduct(product, score) {
  return {
    productId: String(product._id),
    drug: product.drug
      ? {
          id: String(product.drug._id),
          salt: product.drug.salt,
          strength: product.drug.strength,
          form: product.drug.form,
          atcCode: product.drug.atcCode,
        }
      : null,
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
    provenance: product.source,
    score: scoreSummary(score),
    band: score?.band ?? 'LimitedData',
    limitedData: !score || score.band === 'LimitedData',
  };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid search query',
        details: zodDetails(parsed.error),
      });
    }

    const { q, page, limit } = parsed.data;

    let drugs = await Drug.find(
      { $text: { $search: q } },
      { score: { $meta: 'textScore' } }
    )
      .sort({ score: { $meta: 'textScore' } })
      .limit(50)
      .lean();

    let brands = await Brand.find(
      { $text: { $search: q } },
      { score: { $meta: 'textScore' } }
    )
      .sort({ score: { $meta: 'textScore' } })
      .limit(50)
      .lean();

    let source = 'text';

    if (drugs.length === 0 && brands.length === 0) {
      source = 'fuzzy';
      const allDrugs = await Drug.find({}).lean();
      const allBrands = await Brand.find({}).lean();

      drugs = fuzzySearch(q, allDrugs, {
        keySelector: (drug) =>
          `${drug.salt} ${drug.strength} ${drug.form} ${drug.atcCode}`,
        threshold: 0.45,
        limit: 20,
      }).map((match) => match.item);

      brands = fuzzySearch(q, allBrands, {
        keySelector: (brand) => brand.name,
        threshold: 0.45,
        limit: 20,
      }).map((match) => match.item);
    }

    const drugIds = new Set(drugs.map((drug) => String(drug._id)));
    for (const brand of brands) {
      if (brand.drug) drugIds.add(String(brand.drug));
    }
    const brandIds = brands.map((brand) => brand._id);

    if (drugIds.size === 0 && brandIds.length === 0) {
      return res.json({
        query: q,
        source,
        page,
        limit,
        total: 0,
        results: [],
        message: 'No data found for this search.',
      });
    }

    const products = await Product.find({
      $or: [
        { drug: { $in: [...drugIds] } },
        { brand: { $in: brandIds } },
      ],
    })
      .populate('drug manufacturer brand')
      .limit(500)
      .lean();

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
      .map((product) =>
        resultFromProduct(product, latestScore.get(String(product._id)))
      )
      .sort((a, b) => {
        const aScore = a.score?.value ?? -1;
        const bScore = b.score?.value ?? -1;
        if (bScore !== aScore) return bScore - aScore;
        return (a.price ?? 0) - (b.price ?? 0);
      });

    const total = results.length;
    const start = (page - 1) * limit;
    const pageResults = results.slice(start, start + limit);

    if (pageResults.length === 0) {
      return res.json({
        query: q,
        source,
        page,
        limit,
        total,
        results: [],
        message: 'No more results for this search.',
      });
    }

    return res.json({
      query: q,
      source,
      page,
      limit,
      total,
      results: pageResults,
    });
  })
);

export default router;
