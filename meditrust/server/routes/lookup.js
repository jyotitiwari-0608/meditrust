import express from "express";
import { z } from "zod";
import { Barcode } from "../models/Barcode.js";
import { Product } from "../models/Product.js";

const router = express.Router();

const querySchema = z.object({
  code: z.string().min(1),
});

router.get("/", async (req, res, next) => {
  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid query", issues: parsed.error.flatten() });
    }
    const { code } = parsed.data;
    const barcode = await Barcode.findOne({ code }).lean();
    if (!barcode) {
      return res.status(404).json({ error: `No product found for barcode ${code}` });
    }
    let product = null;
    if (barcode.product) {
      product = await Product.findById(barcode.product).populate("manufacturer").lean();
    }
    res.json({
      code,
      product: product
        ? {
            id: product._id,
            brand: product.brand,
            mfr: product.manufacturer ? product.manufacturer.name : null,
            mrp: product.mrp,
            teCode: product.teCode,
            source: product.source,
            isJanAushadhi: product.isJanAushadhi || false,
          }
        : null,
      brand: barcode.brand || null,
      drug: barcode.drug || null,
      source: barcode.source || null,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
