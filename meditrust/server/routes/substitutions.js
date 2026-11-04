import express from "express";
import { z } from "zod";
import { Audit } from "../models/Audit.js";

const router = express.Router();

const confirmSchema = z.object({
  acknowledgement: z.boolean().refine((v) => v === true, {
    message: "acknowledgement must be literally true",
  }),
  actor: z.string().optional(),
  fromBrand: z.string().optional(),
  toBrand: z.string().optional(),
  drug: z.string().optional(),
  riskFlags: z.array(z.string()).optional(),
  band: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

router.post("/confirm", async (req, res, next) => {
  try {
    const parsed = confirmSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid confirmation", issues: parsed.error.flatten() });
    }
    const { acknowledgement, ...rest } = parsed.data;
    const entry = await Audit.create({
      actor: rest.actor || "doctor",
      action: "propose_substitution",
      fromBrand: rest.fromBrand || "",
      toBrand: rest.toBrand || "",
      drug: rest.drug || "",
      riskFlags: rest.riskFlags || [],
      band: rest.band || null,
      confirmed: true,
      acknowledgement: true,
      ip: req.ip,
      metadata: rest.metadata || {},
    });
    res.status(201).json({ ok: true, id: entry._id });
  } catch (err) {
    next(err);
  }
});

export default router;
