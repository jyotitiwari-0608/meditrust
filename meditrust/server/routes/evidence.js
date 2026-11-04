import express from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { Product } from "../models/Product.js";
import { Manufacturer } from "../models/Manufacturer.js";
import { Signal } from "../models/Signal.js";
import { computeFactors, coldStartBaseline, validSignals } from "../services/scoring.js";
import { justifyScore } from "../services/justification.js";

const router = express.Router();

const paramsSchema = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/) });

router.get("/:id/evidence", async (req, res, next) => {
  try {
    const parsed = paramsSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid product id" });
    }
    const { id } = parsed.data;
    const product = await Product.findById(id).populate("drug manufacturer").lean();
    if (!product) return res.status(404).json({ error: "product not found" });

    const manufacturer = product.manufacturer;
    const signals = await Signal.find({ manufacturer: manufacturer._id })
      .sort({ date: -1 })
      .limit(20)
      .lean();
    const numProducts = await Product.countDocuments({ manufacturer: manufacturer._id });

    const hasHighSeverity = signals.some(
      (s) => !(s.date > Date.now()) && (s.severity === "high" || s.severity === "critical")
    );
    let result;
    if (signals.length + numProducts < 5 && !hasHighSeverity) {
      result = coldStartBaseline(manufacturer);
      result.limitedData = true;
    } else {
      result = computeFactors({
        manufacturer,
        signals: validSignals(signals),
        numProducts,
        teCode: product.teCode,
      });
      result.limitedData = false;
    }

    const provenance = signals.map((s) => ({
      id: s._id,
      type: s.type,
      date: s.date,
      severity: s.severity,
      sourceName: s.sourceName,
      sourceUrl: s.sourceUrl,
      rawText: s.rawText,
    }));

    const justification = await justifyScore({
      score: result.score,
      band: result.band,
      factors: result.factors,
    });

    res.json({
      product: {
        id: product._id,
        brand: product.brand,
        drug: product.drug ? product.drug.salt : null,
        strength: product.drug ? product.drug.strength : null,
        form: product.drug ? product.drug.form : null,
        mfr: manufacturer.name,
        mrp: product.mrp,
        teCode: product.teCode,
        source: product.source,
        isJanAushadhi: product.isJanAushadhi || false,
      },
      score: result.score,
      band: result.band,
      version: result.version,
      computedAt: result.computedAt,
      limitedData: result.limitedData,
      factors: result.factors,
      justification,
      provenance,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
