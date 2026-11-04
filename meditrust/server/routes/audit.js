import express from "express";
import { z } from "zod";
import { Audit } from "../models/Audit.js";

const router = express.Router();

const auditSchema = z.object({
  actor: z.string().optional(),
  action: z.string(),
  fromBrand: z.string().optional(),
  toBrand: z.string().optional(),
  drug: z.string().optional(),
  riskFlags: z.array(z.string()).optional(),
  confirmed: z.boolean().default(false),
  ip: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

router.post("/", async (req, res, next) => {
  try {
    const parsed = auditSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid audit payload", issues: parsed.error.flatten() });
    }
    const entry = await Audit.create({ ...parsed.data, ip: req.ip });
    res.status(201).json({ ok: true, id: entry._id });
  } catch (err) {
    next(err);
  }
});

export default router;
