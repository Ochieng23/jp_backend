import logger from '../utils/logger.js';

// MinIO / S3 file storage is optional in the MVP.
// If MINIO_ENDPOINT is not set, all file operations are no-ops that return null.

const ENABLED = Boolean(process.env.MINIO_ENDPOINT);
const BUCKET = process.env.MINIO_BUCKET || 'cazini';

let minioClient = null;

if (ENABLED) {
  const { Client } = await import('minio');
  minioClient = new Client({
    endPoint:  process.env.MINIO_ENDPOINT,
    port:      parseInt(process.env.MINIO_PORT || '9000', 10),
    useSSL:    process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY,
    secretKey: process.env.MINIO_SECRET_KEY,
  });
} else {
  logger.warn('MINIO_ENDPOINT not set — file upload/download features are disabled');
}

/**
 * Ensure the configured bucket exists. No-op if MinIO is disabled.
 */
export async function createBucketIfNotExists() {
  if (!minioClient) return;
  try {
    const exists = await minioClient.bucketExists(BUCKET);
    if (!exists) {
      await minioClient.makeBucket(BUCKET, 'us-east-1');
      logger.info(`MinIO: bucket '${BUCKET}' created`);
    } else {
      logger.info(`MinIO: bucket '${BUCKET}' ready`);
    }
  } catch (err) {
    logger.warn(`MinIO: bucket check failed — ${err.message}`);
  }
}

/**
 * Generate a presigned upload URL. Returns null if MinIO is disabled.
 * @param {string} key
 * @param {number} [expiry=3600]
 * @returns {Promise<string|null>}
 */
export async function getPresignedUploadUrl(key, expiry = 3600) {
  if (!minioClient) return null;
  return minioClient.presignedPutObject(BUCKET, key, expiry);
}

/**
 * Generate a presigned download URL. Returns null if MinIO is disabled.
 * @param {string} key
 * @param {number} [expiry=3600]
 * @returns {Promise<string|null>}
 */
export async function getPresignedDownloadUrl(key, expiry = 3600) {
  if (!minioClient) return null;
  return minioClient.presignedGetObject(BUCKET, key, expiry);
}

/**
 * Delete an object. No-op if MinIO is disabled.
 * @param {string} key
 */
export async function deleteObject(key) {
  if (!minioClient) return;
  await minioClient.removeObject(BUCKET, key);
}

export default minioClient;
