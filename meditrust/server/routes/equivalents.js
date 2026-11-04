import express from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { Drug } from "../models/Drug.js";
import { Product } from "../models/Product.js";
import { Manufacturer } from "../models/Manufacturer.js";
import { Signal } from "../models/Signal.js";
import { scoreSnapshot } from "../services/scoreSnapshot.js";

const router = express.Router();

const paramsSchema = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/) });

router.get("/:id/equivalents", async (req, res, next) => {
  try {
    const parsed = paramsSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid drug id" });
    }
    const { id } = parsed.data;
    const drug = await Drug.findById(id);
    if (!drug) return res.status(404).json({ error: "drug not found" });

    const products = await Product.find({ drug: id }).populate("manufacturer").lean();
    if (products.length === 0) {
      return res.status(404).json({ error: "no products found for this drug" });
    }

    // Reference = highest MRP product so savings figures are meaningful.
    products.sort((a, b) => (b.mrp || 0) - (a.mrp || 0));
    const reference = products[0];
    const refMfr = reference.manufacturer;
    const refScore = await scoreSnapshot(refMfr._id);

    // Batch score lookups per unique manufacturer.
    const scoreCache = new Map();
    await Promise.all(
      Array.from(new Set(products.map((p) => p.manufacturer._id))).map(async (id) => {
        scoreCache.set(id.toString(), await scoreSnapshot(id));
      })
    );

    const equivalents = products.map((p) => {
      const mfrId = p.manufacturer._id.toString();
      const s = scoreCache.get(mfrId) || { score: 40, band: "LimitedData", limitedData: true, factors: [] };
      const savings = reference.mrp && p.mrp ? reference.mrp - p.mrp : null;
      const provenance = [];
      if (p.source) {
        provenance.push({ sourceName: p.source, sourceUrl: null, date: null });
      }
      return {
        productId: p._id,
        brand: p.brand,
        mfr: p.manufacturer.name,
        mrp: p.mrp,
        teCode: p.teCode,
        source: p.source,
        isJanAushadhi: p.isJanAushadhi || false,
        score: s.score,
        band: s.band,
        limitedData: s.limitedData,
        savings,
        factors: s.factors,
        provenance,
      };
    });

    equivalents.sort((a, b) => b.score - a.score || (a.mrp || 0) - (b.mrp || 0));

    res.json({
      drug: { id: drug._id, salt: drug.salt, strength: drug.strength, form: drug.form },
      reference: {
        brand: reference.brand,
        mfr: refMfr.name,
        mrp: reference.mrp,
        score: refScore.score,
        band: refScore.band,
      },
      equivalents,
      count: equivalents.length,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
