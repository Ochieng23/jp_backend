import 'dotenv/config';
import mongoose from 'mongoose';
import app from './src/app.js';
import { connectDB } from './src/config/db.js';
import logger from './src/utils/logger.js';

// ─── Required environment variables ──────────────────────────────────────────
const REQUIRED_ENV = ['MONGODB_URI', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];
const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const PORT = process.env.PORT || 5000;

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught Exception: ${err.message}\n${err.stack}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.stack : String(reason);
  logger.error(`Unhandled Rejection: ${msg}`);
  process.exit(1);
});

(async () => {
  try {
    await connectDB();
    const server = app.listen(PORT, () => {
      logger.info(`Cazini API running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
    });

    // ─── Graceful shutdown ────────────────────────────────────────────────────
    async function shutdown(signal) {
      logger.info(`${signal} received — shutting down gracefully`);
      server.close(async () => {
        try {
          await mongoose.disconnect();
          logger.info('MongoDB disconnected. Process exiting.');
        } catch (err) {
          logger.error(`Error during shutdown: ${err.message}`);
        }
        process.exit(0);
      });

      // Force exit after 10 s if graceful close stalls
      setTimeout(() => {
        logger.warn('Graceful shutdown timed out — forcing exit');
        process.exit(1);
      }, 10_000).unref();
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err) {
    logger.error(`Failed to start server: ${err.message}`);
    process.exit(1);
  }
})();
