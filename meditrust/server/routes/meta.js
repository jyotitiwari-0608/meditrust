import express from "express";

const router = express.Router();

router.get("/", (req, res) => {
  const isDemo = process.env.DEMO_MODE === "true" || process.env.MONGODB_URI?.includes("_demo") || process.env.DEMO_MONGODB_URI ? true : false;
  res.json({ demo: isDemo, service: "meditrust-server" });
});

export default router;
