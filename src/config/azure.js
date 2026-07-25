import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';
import logger from '../utils/logger.js';

const ACCOUNT = process.env.AZURE_STORAGE_ACCOUNT_NAME;
const ACCOUNT_KEY = process.env.AZURE_STORAGE_ACCOUNT_KEY;
const CONTAINER = process.env.AZURE_STORAGE_CONTAINER_NAME || 'cazini-docs';

let blobServiceClient = null;
let containerClient = null;

if (ACCOUNT && ACCOUNT_KEY) {
  const credential = new StorageSharedKeyCredential(ACCOUNT, ACCOUNT_KEY);
  blobServiceClient = new BlobServiceClient(
    `https://${ACCOUNT}.blob.core.windows.net`,
    credential
  );
  containerClient = blobServiceClient.getContainerClient(CONTAINER);
  logger.info(`Azure Blob Storage configured — account: ${ACCOUNT}, container: ${CONTAINER}`);
} else {
  logger.warn('AZURE_STORAGE_ACCOUNT_NAME or AZURE_STORAGE_ACCOUNT_KEY not set — file uploads disabled');
}

export function isAzureConfigured() {
  return Boolean(containerClient);
}

export async function ensureContainer() {
  if (!containerClient) return;
  try {
    await containerClient.createIfNotExists({ access: 'blob' });
  } catch (err) {
    logger.warn(`Azure: container check failed — ${err.message}`);
  }
}

export async function uploadBuffer(blobName, buffer, contentType) {
  if (!containerClient) return null;
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  await blockBlobClient.upload(buffer, buffer.length, {
    blobHTTPHeaders: { blobContentType: contentType },
  });
  return blockBlobClient.url;
}

export async function deleteBlob(blobName) {
  if (!containerClient) return;
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  await blockBlobClient.deleteIfExists();
}

export { containerClient };
export default blobServiceClient;
