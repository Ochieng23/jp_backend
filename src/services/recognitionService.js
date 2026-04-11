import { v4 as uuidv4 } from 'uuid';
import * as jurisdictionRepository from '../repositories/jurisdictionRepository.js';
import * as credentialRepository from '../repositories/credentialRepository.js';
import * as recognitionRepository from '../repositories/recognitionRepository.js';
import * as auditRepository from '../repositories/auditRepository.js';
import logger from '../utils/logger.js';

/**
 * Apply a jurisdiction's recognition_rules to a single credential.
 * Looks up the credential type in the jurisdiction's recognition_rules JSONB.
 * Maps to equivalent_type and recognition_status, then upserts the
 * credential_recognition table. Logs an audit event with before/after metadata.
 *
 * Recognition rules JSONB format expected:
 * {
 *   "NursingCertificate": { "status": "recognised", "equivalent_type": "RegisteredNurse" },
 *   "WeldingCertificate": { "status": "partial", "equivalent_type": "WelderGrade2" }
 * }
 *
 * @param {string} credentialId - UUID of the credential to evaluate
 * @param {string} targetJurisdictionId - UUID of the target jurisdiction
 * @returns {Promise<object>} The upserted credential_recognition row
 */
export async function evaluateRecognition(credentialId, targetJurisdictionId) {
  const [credential, jurisdiction] = await Promise.all([
    credentialRepository.findCredentialById(credentialId),
    jurisdictionRepository.findById(targetJurisdictionId),
  ]);

  if (!credential) {
    const err = new Error(`Credential ${credentialId} not found`);
    err.statusCode = 404;
    throw err;
  }
  if (!jurisdiction) {
    const err = new Error(`Jurisdiction ${targetJurisdictionId} not found`);
    err.statusCode = 404;
    throw err;
  }

  // Fetch existing recognition for before/after audit diff
  const existing = await recognitionRepository.findByCredentialAndJurisdiction(
    credentialId,
    targetJurisdictionId
  );

  // Apply recognition rules
  const rules =
    typeof jurisdiction.recognition_rules === 'string'
      ? JSON.parse(jurisdiction.recognition_rules)
      : (jurisdiction.recognition_rules || {});

  const rule = rules[credential.type];

  let recognitionStatus;
  let equivalentType = null;
  let notes = null;

  if (rule) {
    recognitionStatus = rule.status || 'recognised';
    equivalentType = rule.equivalent_type || null;
    notes = rule.notes || null;
  } else {
    recognitionStatus = 'not_recognised';
    notes = `Credential type '${credential.type}' is not listed in ${jurisdiction.country_name} recognition rules`;
  }

  const recognitionRow = await recognitionRepository.upsertRecognition({
    id: existing ? existing.id : uuidv4(),
    source_credential_id: credentialId,
    target_jurisdiction_id: targetJurisdictionId,
    equivalent_type: equivalentType,
    recognition_status: recognitionStatus,
    notes,
    evaluated_at: new Date().toISOString(),
  });

  // Audit log with before/after
  await auditRepository.logAction({
    id: uuidv4(),
    actor_id: null,
    actor_type: 'admin',
    action: 'recognition.evaluated',
    resource_type: 'credential_recognition',
    resource_id: recognitionRow.id,
    metadata: {
      credential_id: credentialId,
      jurisdiction_id: targetJurisdictionId,
      jurisdiction_name: jurisdiction.country_name,
      before: existing
        ? {
            recognition_status: existing.recognition_status,
            equivalent_type: existing.equivalent_type,
          }
        : null,
      after: {
        recognition_status: recognitionStatus,
        equivalent_type: equivalentType,
      },
    },
    jurisdiction_id: targetJurisdictionId,
  });

  logger.info(
    `Recognition evaluated: credential ${credentialId} in ${jurisdiction.country_name} → ${recognitionStatus}`
  );

  return recognitionRow;
}

/**
 * Get the full recognition matrix for a holder.
 * Returns one row per credential, each with an array of recognition evaluations
 * across all jurisdictions where the credential has been evaluated.
 *
 * @param {string} holderId - UUID of the holder
 * @returns {Promise<object[]>} Matrix rows with credential info and per-jurisdiction recognitions
 */
export async function getRecognitionMatrix(holderId) {
  const matrix = await recognitionRepository.getRecognitionMatrix(holderId);
  return matrix;
}

/**
 * Trigger recognition evaluation for all active credentials of a holder
 * against a specific target jurisdiction. Enqueues BullMQ jobs for each credential.
 *
 * @param {string} holderId - UUID of the holder
 * @param {string} targetJurisdictionId - UUID of the jurisdiction to evaluate against
 * @returns {Promise<{ jobIds: string[] }>}
 */
export async function triggerBulkEvaluation(holderId, targetJurisdictionId) {
  const jurisdiction = await jurisdictionRepository.findById(targetJurisdictionId);
  if (!jurisdiction) {
    const err = new Error('Target jurisdiction not found');
    err.statusCode = 404;
    throw err;
  }

  const { rows: credentials } = await credentialRepository.findCredentialsByHolder(holderId, {
    status: 'active',
    limit: 500,
    offset: 0,
  });

  if (credentials.length === 0) {
    return { jobIds: [] };
  }

  // Run evaluations synchronously in the MVP (no background queue).
  const results = [];
  for (const credential of credentials) {
    const row = await evaluateRecognition(
      String(credential.id || credential._id),
      targetJurisdictionId
    );
    results.push(row);
  }

  logger.info(
    `Bulk recognition evaluated: ${results.length} credentials for holder ${holderId} in ${jurisdiction.country_name}`
  );

  return { evaluated: results.length };
}
