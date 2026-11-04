import express from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { Drug } from "../models/Drug.js";
import { Product } from "../models/Product.js";
import { Manufacturer } from "../models/Manufacturer.js";
import { scoreSnapshot } from "../services/scoreSnapshot.js";
import { search as fuzzySearch } from "fast-fuzzy";

const router = express.Router();

const searchSchema = z.object({
  q: z.string().min(1).max(100),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

router.get("/", async (req, res, next) => {
  try {
    const parsed = searchSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid query", issues: parsed.error.flatten() });
    }
    const { q, page, limit } = parsed.data;
    const skip = (page - 1) * limit;
    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

    const [drugs, products, manufacturers] = await Promise.all([
      Drug.find({ category: { $exists: true }, $or: [{ salt: regex }, { strength: regex }] })
        .limit(limit)
        .lean(),
      Product.find({ $or: [{ brand: regex }, { teCode: regex }] })
        .populate("drug manufacturer")
        .limit(limit)
        .lean(),
      Manufacturer.find({ name: regex }).limit(limit).lean(),
    ]);

    let results = [];
    const seen = new Set();
    const push = (item) => {
      if (seen.has(item._id.toString())) return;
      seen.add(item._id.toString());
      results.push(item);
    };
    drugs.forEach(push);
    products.forEach(push);
    manufacturers.forEach((m) => push({ _id: m._id, kind: "manufacturer", name: m.name }));

    // Fuzzy typo fallback when no direct matches.
    if (results.length === 0) {
      const [allDrugs, allProducts, allMfrs] = await Promise.all([
        Drug.find({ category: { $exists: true } }).lean(),
        Product.find().populate("drug manufacturer").lean(),
        Manufacturer.find().lean(),
      ]);
      const fuzzyDrugs = fuzzySearch(q, allDrugs.map((d) => d.salt)).slice(0, limit);
      const fuzzyBrands = fuzzySearch(q, allProducts.map((p) => p.brand || "")).slice(0, limit);
      const fuzzyMfrs = fuzzySearch(q, allMfrs.map((m) => m.name)).slice(0, limit);

      const fuzzyDrugSet = new Set(fuzzyDrugs.map((r) => r.item));
      allDrugs.forEach((d) => {
        if (fuzzyDrugSet.has(d)) push(d);
      });
      const fuzzyBrandSet = new Set(fuzzyBrands.map((r) => r.item));
      allProducts.forEach((p) => {
        if (fuzzyBrandSet.has(p)) push(p);
      });
      const fuzzyMfrSet = new Set(fuzzyMfrs.map((r) => r.item));
      allMfrs.forEach((m) => {
        if (fuzzyMfrSet.has(m)) push({ _id: m._id, kind: "manufacturer", name: m.name });
      });
    }

    // Batch score lookup to avoid N+1 per result.
    const mfrIds = new Set();
    for (const r of results.slice(skip, skip + limit)) {
      if (r.drug && r.manufacturer) mfrIds.add(r.manufacturer._id || r.manufacturer);
    }
    const scoreCache = new Map();
    await Promise.all(
      Array.from(mfrIds).map(async (id) => {
        scoreCache.set(id.toString(), await scoreSnapshot(id));
      })
    );

    const pageResults = results.slice(skip, skip + limit).map((r) => {
      if (r.kind === "manufacturer") {
        return { id: r._id, kind: "manufacturer", name: r.name };
      }
      if (r.drug && r.manufacturer) {
        const mfrId = (r.manufacturer._id || r.manufacturer).toString();
        const score = scoreCache.get(mfrId) || { score: 40, band: "LimitedData", limitedData: true };
        return {
          id: r._id,
          kind: "product",
          brand: r.brand,
          drug: r.drug.salt,
          strength: r.drug.strength,
          form: r.drug.form,
          mfr: r.manufacturer.name,
          mrp: r.mrp,
          teCode: r.teCode,
          score: score.score,
          band: score.band,
          limitedData: score.limitedData,
        };
      }
      return { id: r._id, kind: "drug", salt: r.salt, strength: r.strength, form: r.form };
    });

    res.json({
      query: q,
      page,
      limit,
      total: results.length,
      results: pageResults,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
