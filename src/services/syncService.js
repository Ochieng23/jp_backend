import * as recognitionService from './recognitionService.js';
import * as jurisdictionRepository from '../repositories/jurisdictionRepository.js';
import * as credentialRepository from '../repositories/credentialRepository.js';
import * as holderRepository from '../repositories/holderRepository.js';
import logger from '../utils/logger.js';

/**
 * Re-evaluate all active credentials for all holders against a jurisdiction's rules.
 * Runs synchronously in the MVP (no background queue).
 *
 * @param {string} jurisdictionId
 * @returns {Promise<{ evaluated: number }>}
 */
export async function syncJurisdictionRules(jurisdictionId) {
  const jurisdiction = await jurisdictionRepository.findById(jurisdictionId);
  if (!jurisdiction) {
    throw new Error(`Jurisdiction ${jurisdictionId} not found`);
  }

  logger.info(`Starting sync for jurisdiction: ${jurisdiction.country_name}`);

  // Fetch all active credentials linked to this jurisdiction
  const { rows: credentials } = await credentialRepository.findCredentialsByJurisdiction(
    jurisdictionId,
    { status: 'active', limit: 1000, offset: 0 }
  );

  let evaluated = 0;
  for (const credential of credentials) {
    try {
      await recognitionService.evaluateRecognition(
        String(credential.id || credential._id),
        jurisdictionId
      );
      evaluated++;
    } catch (err) {
      logger.warn(`Sync: failed to evaluate credential ${credential.id}: ${err.message}`);
    }
  }

  logger.info(`Jurisdiction sync complete: ${evaluated} credentials evaluated for ${jurisdiction.country_name}`);
  return { evaluated };
}

/**
 * No-op stub kept for API compatibility — job tracking removed in MVP.
 */
export async function getSyncJobStatus(_jobId) {
  const err = new Error('Job status tracking not available in this deployment');
  err.statusCode = 501;
  throw err;
}
