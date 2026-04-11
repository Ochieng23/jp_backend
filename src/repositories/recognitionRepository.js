import CredentialRecognition from '../models/CredentialRecognition.js';
import Credential from '../models/Credential.js';

/**
 * Insert or update a credential recognition record.
 * Upserts on the unique index (source_credential_id, target_jurisdiction_id).
 *
 * @param {object} data
 * @returns {Promise<object>} Upserted recognition row
 */
export async function upsertRecognition(data) {
  const {
    source_credential_id,
    target_jurisdiction_id,
    equivalent_type,
    recognition_status,
    notes,
    evaluated_at,
  } = data;

  const result = await CredentialRecognition.findOneAndUpdate(
    { source_credential_id, target_jurisdiction_id },
    {
      $set: {
        equivalent_type: equivalent_type || null,
        recognition_status,
        notes: notes || null,
        evaluated_at: evaluated_at || new Date(),
      },
    },
    { upsert: true, new: true, runValidators: true }
  ).lean();

  return result;
}

/**
 * Get all recognition records for a holder (via their credentials).
 * @param {string} holderId
 * @returns {Promise<object[]>}
 */
export async function findByHolder(holderId) {
  const credIds = await Credential.find({ holder_id: holderId }).distinct('_id');
  return CredentialRecognition.find({ source_credential_id: { $in: credIds } })
    .populate('source_credential_id', 'title type status issued_at expires_at')
    .populate('target_jurisdiction_id', 'country_code country_name')
    .sort({ evaluated_at: -1 })
    .lean();
}

/**
 * Find a specific recognition record for a credential in a target jurisdiction.
 * @param {string} credentialId
 * @param {string} jurisdictionId
 * @returns {Promise<object|null>}
 */
export async function findByCredentialAndJurisdiction(credentialId, jurisdictionId) {
  return CredentialRecognition.findOne({
    source_credential_id: credentialId,
    target_jurisdiction_id: jurisdictionId,
  })
    .populate('target_jurisdiction_id', 'country_code country_name')
    .lean();
}

/**
 * Get the full recognition matrix for a holder.
 * Returns one entry per credential, with an array of recognition statuses per jurisdiction.
 *
 * @param {string} holderId
 * @returns {Promise<object[]>}
 */
export async function getRecognitionMatrix(holderId) {
  const credentials = await Credential.find({ holder_id: holderId })
    .sort({ issued_at: -1 })
    .populate('jurisdiction_id', 'country_code country_name')
    .lean();

  const matrix = await Promise.all(
    credentials.map(async (cred) => {
      const recognitions = await CredentialRecognition.find({
        source_credential_id: cred._id,
      })
        .populate('target_jurisdiction_id', 'country_code country_name')
        .lean();

      return {
        credential: {
          id: cred._id,
          title: cred.title,
          type: cred.type,
          status: cred.status,
          issued_at: cred.issued_at,
          expires_at: cred.expires_at,
          home_jurisdiction: cred.jurisdiction_id,
        },
        recognitions: recognitions.map((r) => ({
          jurisdiction: r.target_jurisdiction_id,
          recognition_status: r.recognition_status,
          equivalent_type: r.equivalent_type,
          notes: r.notes,
          evaluated_at: r.evaluated_at,
        })),
      };
    })
  );

  return matrix;
}
