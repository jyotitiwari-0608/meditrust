import { Router } from 'express';
import mongoose from 'mongoose';

const router = Router();

const DB_STATES = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'meditrust-api',
    db: DB_STATES[mongoose.connection.readyState] ?? 'unknown',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

export default router;
