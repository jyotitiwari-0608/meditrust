import express from "express";
import { z } from "zod";
import { Signal } from "../models/Signal.js";
import { Extraction } from "../models/Extraction.js";
import { Manufacturer } from "../models/Manufacturer.js";
import { Product } from "../models/Product.js";
import { scoreManufacturer } from "../services/scoring.js";

const router = express.Router();

// Admin API-key middleware: x-api-key header must equal ADMIN_API_KEY.
router.use((req, res, next) => {
  const expectedKey = process.env.ADMIN_API_KEY;
  if (!expectedKey) {
    return res.status(500).json({ error: "ADMIN_API_KEY not configured" });
  }
  const key = req.headers["x-api-key"];
  if (!key || key !== expectedKey) {
    return res.status(401).json({ error: "admin API key required" });
  }
  next();
});

const reviewIdSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/),
});

const reviewActionSchema = z.object({
  action: z.enum(["approve", "correct", "reject"]),
  reviewer: z.string().min(1),
  correctedFields: z.record(z.string(), z.any()).optional(),
});

// GET /api/admin/review — list REVIEW signals and needsReview extractions
router.get("/review", async (_req, res, next) => {
  try {
    const signals = await Signal.find({
      $or: [{ matchStatus: "REVIEW" }, { matchStatus: "UNMATCHED" }],
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    const extractions = await Extraction.find({ needsReview: true })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.json({
      signals: signals.map((s) => ({ ...s, kind: "signal" })),
      extractions: extractions.map((e) => ({ ...e, kind: "extraction" })),
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/review/:id — approve/correct/reject a review item
router.patch("/review/:id", async (req, res, next) => {
  try {
    const idParsed = reviewIdSchema.safeParse(req.params);
    if (!idParsed.success) {
      return res.status(400).json({ error: "invalid review id" });
    }
    const actionParsed = reviewActionSchema.safeParse(req.body);
    if (!actionParsed.success) {
      return res.status(400).json({ error: "invalid action", issues: actionParsed.error.flatten() });
    }
    const { id } = idParsed.data;
    const { action, reviewer, correctedFields } = actionParsed.data;
    const reviewedAt = new Date();

    // Try Signal first, then Extraction.
    let doc = await Signal.findById(id);
    let kind = "signal";
    if (!doc) {
      doc = await Extraction.findById(id);
      kind = "extraction";
    }
    if (!doc) {
      return res.status(404).json({ error: "review item not found" });
    }

    if (kind === "signal") {
      doc.matchStatus = action === "reject" ? "UNMATCHED" : "MATCHED";
      doc.manualReview = true;
      if (correctedFields) {
        if (correctedFields.severity) doc.severity = correctedFields.severity;
        if (correctedFields.manufacturer) {
          const mfr = await Manufacturer.findOne({ name: correctedFields.manufacturer });
          if (mfr) doc.manufacturer = mfr._id;
        }
      }
      await doc.save();
      // Recompute the affected manufacturer's score.
      if (doc.manufacturer) {
        try {
          await scoreManufacturer(doc.manufacturer.toString());
        } catch (_) {
          // scoring failure should not block review approval
        }
      }
    } else {
      doc.needsReview = false;
      if (correctedFields) doc.json = { ...doc.json, ...correctedFields };
      doc.reviewer = reviewer;
      doc.reviewedAt = reviewedAt;
      await doc.save();
    }

    res.json({ ok: true, kind, id, action, reviewedAt });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/audit — list audit log entries
router.get("/audit", async (_req, res, next) => {
  try {
    const { Audit } = await import("../models/Audit.js");
    const entries = await Audit.find().sort({ createdAt: -1 }).limit(100).lean();
    res.json({ entries });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/extract/run — run extraction on pending signals (placeholder)
router.post("/extract/run", async (_req, res, next) => {
  try {
    res.json({ ok: true, message: "extract/run placeholder — extraction runs inline on signal creation" });
  } catch (err) {
    next(err);
  }
});

export default router;
