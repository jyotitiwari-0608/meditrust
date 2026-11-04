import { Router } from 'express';
import { loadNarrowTherapeuticIndex, pilotEntries } from '../utils/config.js';

const router = Router();

router.get('/narrow-therapeutic-index', (req, res) => {
  const config = loadNarrowTherapeuticIndex();
  res.json({ salts: config.salts });
});

router.get('/pilot', (req, res) => {
  res.json({ salts: pilotEntries() });
});

export default router;
