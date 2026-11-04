import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { MongoMemoryServer } from "mongodb-memory-server";

import healthRouter from "./routes/health.js";
import searchRouter from "./routes/search.js";
import equivalentsRouter from "./routes/equivalents.js";
import evidenceRouter from "./routes/evidence.js";
import auditRouter from "./routes/audit.js";
import metaRouter from "./routes/meta.js";
import substitutionsRouter from "./routes/substitutions.js";
import lookupRouter from "./routes/lookup.js";
import ntiRouter from "./routes/nti.js";
import adminRouter from "./routes/admin.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

let mongoMemoryServer = null;

// In production, CORS_ORIGIN must be set explicitly; no '*' fallback.
if (process.env.NODE_ENV === "production" && !process.env.CORS_ORIGIN) {
  throw new Error("CORS_ORIGIN is required when NODE_ENV=production");
}

async function connectDb() {
  const uri = process.env.MONGODB_URI;
  const isDemo = process.env.DEMO_MODE === "true";
  const hasRealUri = uri && !uri.includes("<cluster>") && !uri.includes("<user>") && !uri.includes("<pass>");

  if (isDemo && !hasRealUri) {
    mongoMemoryServer = await MongoMemoryServer.create();
    const memoryUri = mongoMemoryServer.getUri();
    console.log("Starting in-memory demo database...");
    await mongoose.connect(memoryUri);
    console.log("MongoDB (in-memory demo) connected");
  } else if (hasRealUri) {
    await mongoose.connect(uri);
    console.log("MongoDB connected to Atlas");
  } else {
    throw new Error(
      "No valid MONGODB_URI found. Set MONGODB_URI in .env, or run with DEMO_MODE=true for in-memory demo database."
    );
  }
}

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(morgan("dev"));
app.use(express.json({ limit: "100kb" }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false }));

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "meditrust-server",
    timestamp: new Date().toISOString(),
    db: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    demo: process.env.DEMO_MODE === "true",
  });
});

app.use("/api/health", healthRouter);
app.use("/api/search", searchRouter);
app.use("/api/drugs", equivalentsRouter);
app.use("/api/products", evidenceRouter);
app.use("/api/audit", auditRouter);
app.use("/api/meta", metaRouter);
app.use("/api/substitutions", substitutionsRouter);
app.use("/api/lookup", lookupRouter);
app.use("/api/config", ntiRouter);
app.use("/api/admin", adminRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "internal server error" });
});

connectDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server listening on :${PORT}`);
    });
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err.message);
    process.exit(1);
  });

export default app;
