import { Router } from 'express';
import { z } from 'zod';
import { Audit, Product } from '../models/index.js';
import { asyncHandler, zodDetails } from '../utils/http.js';

const router = Router();

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid product id');

const auditSchema = z
  .object({
    fromProduct: objectId,
    toProduct: objectId,
    risks: z.array(z.string().trim().min(1)).max(20).default([]),
    note: z.string().trim().max(500).optional(),
    confirmed: z.literal(true),
  })
  .refine((value) => value.fromProduct !== value.toProduct, {
    message: 'fromProduct and toProduct must differ',
    path: ['toProduct'],
  });

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = auditSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid audit payload',
        details: zodDetails(parsed.error),
      });
    }

    const [fromProduct, toProduct] = await Promise.all([
      Product.findById(parsed.data.fromProduct).lean(),
      Product.findById(parsed.data.toProduct).lean(),
    ]);

    if (!fromProduct || !toProduct) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const audit = await Audit.create(parsed.data);

    return res.status(201).json({
      id: String(audit._id),
      action: audit.action,
      confirmedAt: audit.confirmedAt,
      message:
        'Substitution confirmed and logged. This is an audit record, not a prescription.',
    });
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const audits = await Audit.find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('fromProduct toProduct', 'mrp teCode')
      .lean();

    return res.json({ audits });
  })
);

export default router;
