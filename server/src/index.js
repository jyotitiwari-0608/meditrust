import 'dotenv/config';
import { app } from './app.js';
import { connectDB, disconnectDB } from './config/db.js';

const port = Number(process.env.PORT) || 5000;

async function start() {
  await connectDB();

  const server = app.listen(port, () => {
    console.log(`MediTrust API listening on http://localhost:${port}`);
    console.log(`Health check: http://localhost:${port}/health`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down...`);
    server.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((error) => {
  console.error(`Failed to start server: ${error.message}`);
  process.exit(1);
});
