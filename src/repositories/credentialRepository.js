import Credential from '../models/Credential.js';
import IssuingOrganization from '../models/IssuingOrganization.js';

/**
 * Create a new credential record.
 * @param {object} data
 * @returns {Promise<object>} Created credential (lean)
 */
export async function createCredential(data) {
  const credential = await Credential.create(data);
  return credential.toObject();
}

/**
 * Find a credential by its MongoDB _id.
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function findCredentialById(id) {
  return Credential.findById(id).lean();
}

/**
 * Find credentials belonging to a holder, with optional filters and pagination.
 * @param {string} holderId
 * @param {object} [filters] - { type?, status?, jurisdiction_id?, limit?, offset? }
 * @returns {Promise<{ rows: object[], total: number }>}
 */
export async function findCredentialsByHolder(holderId, filters = {}) {
  const q = { holder_id: holderId };
  if (filters.type) q.type = filters.type;
  if (filters.status) q.status = filters.status;
  if (filters.jurisdiction_id) q.jurisdiction_id = filters.jurisdiction_id;

  const total = await Credential.countDocuments(q);
  const limit = filters.limit || 20;
  const skip = filters.offset || 0;

  const rows = await Credential.find(q)
    .sort({ issued_at: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return { rows, total };
}

/**
 * Update the status of a credential.
 * @param {string} id
 * @param {'active'|'revoked'|'suspended'} status
 * @returns {Promise<object|null>}
 */
export async function updateCredentialStatus(id, status) {
  return Credential.findByIdAndUpdate(id, { status }, { new: true }).lean();
}

/**
 * Get a credential populated with its issuer organisation.
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getCredentialWithIssuer(id) {
  return Credential.findById(id)
    .populate('issuer_id', 'name did type verified jurisdiction_id public_key_jwk')
    .populate('jurisdiction_id', 'country_code country_name')
    .lean();
}

/**
 * Find active credentials linked to a specific jurisdiction.
 * @param {string} jurisdictionId
 * @param {object} [filters] - { status?, limit?, offset? }
 * @returns {Promise<{ rows: object[], total: number }>}
 */
export async function findCredentialsByJurisdiction(jurisdictionId, filters = {}) {
  const q = { jurisdiction_id: jurisdictionId };
  if (filters.status) q.status = filters.status;

  const total = await Credential.countDocuments(q);
  const limit = filters.limit || 20;
  const skip = filters.offset || 0;

  const rows = await Credential.find(q)
    .sort({ issued_at: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return { rows, total };
}

/**
 * Count credentials grouped by type for a given holder.
 * @param {string} holderId
 * @returns {Promise<Array<{ type: string, count: number }>>}
 */
export async function countByHolderAndType(holderId) {
  const results = await Credential.aggregate([
    { $match: { holder_id: holderId } },
    { $group: { _id: '$type', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  return results.map((r) => ({ type: r._id, count: r.count }));
}
