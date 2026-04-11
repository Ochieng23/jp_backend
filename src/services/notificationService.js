import logger from '../utils/logger.js';

// Notifications are logged only in the MVP (no email / push / queue).

export async function notifyCredentialIssued(holderId, credentialData) {
  logger.info(`[notify] credential-issued holder=${holderId} credential=${credentialData.id}`);
}

export async function notifyCredentialRevoked(holderId, credentialId, reason) {
  logger.info(`[notify] credential-revoked holder=${holderId} credential=${credentialId} reason=${reason}`);
}

export async function notifyRecognitionUpdated(holderId, credentialId, jurisdictionName, recognitionStatus) {
  logger.info(
    `[notify] recognition-updated holder=${holderId} credential=${credentialId} jurisdiction=${jurisdictionName} status=${recognitionStatus}`
  );
}
