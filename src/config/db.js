import mongoose from 'mongoose';
import logger from '../utils/logger.js';

/**
 * Connect to MongoDB via Mongoose.
 * Reads MONGODB_URI from environment. Exits the process on failure.
 */
export async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set in environment variables');

  mongoose.set('strictQuery', true);

  mongoose.connection.on('connected', () =>
    logger.info(`MongoDB connected: ${mongoose.connection.host}`)
  );
  mongoose.connection.on('error', (err) =>
    logger.error(`MongoDB connection error: ${err.message}`)
  );
  mongoose.connection.on('disconnected', () =>
    logger.warn('MongoDB disconnected')
  );

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
  } catch (err) {
    logger.error(`Failed to connect to MongoDB: ${err.message}`);
    process.exit(1);
  }
}

export default mongoose;
