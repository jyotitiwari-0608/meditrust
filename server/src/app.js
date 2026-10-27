import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import healthRouter from './routes/health.js';
import searchRouter from './routes/search.js';
import drugsRouter from './routes/drugs.js';
import productsRouter from './routes/products.js';
import auditRouter from './routes/audit.js';
import configRouter from './routes/config.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: process.env.CLIENT_ORIGIN
        ? process.env.CLIENT_ORIGIN.split(',').map((origin) => origin.trim())
        : '*',
    })
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

  app.get('/', (req, res) => {
    res.json({
      service: 'meditrust-api',
      message: 'Decision-support API. This system never auto-prescribes.',
    });
  });

  app.use('/health', healthRouter);
  app.use('/api/health', healthRouter);
  app.use('/api/search', searchRouter);
  app.use('/api/drugs', drugsRouter);
  app.use('/api/products', productsRouter);
  app.use('/api/audit', auditRouter);
  app.use('/api/config', configRouter);

  app.use((req, res) => {
    res.status(404).json({ error: 'Not found', path: req.originalUrl });
  });

  app.use((err, req, res, next) => {
    const isParseError = err.type === 'entity.parse.failed';
    const isCastError = err.name === 'CastError';
    const status = err.status || (isParseError || isCastError ? 400 : 500);

    res.status(status).json({
      error:
        status >= 500
          ? 'Internal server error'
          : err.message || 'Invalid request',
      ...(err.details ? { details: err.details } : {}),
    });
  });

  return app;
}

export const app = createApp();
export default app;
