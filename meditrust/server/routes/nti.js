import express from "express";
import fs from "fs";
import path from "path";

const router = express.Router();

router.get("/nti", (_req, res) => {
  const ntiPath = path.join(process.cwd(), "config", "narrowTherapeuticIndex.json");
  try {
    const data = JSON.parse(fs.readFileSync(ntiPath, "utf8"));
    res.json({ nti: data });
  } catch (err) {
    res.status(500).json({ error: "NTI config unavailable" });
  }
});

export default router;
