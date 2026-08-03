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
 * Update a self-reported credential's editable fields. Only callable while
 * proof_value === 'self-reported' — enforced by the route, not here, since
 * the route needs to distinguish "not found" from "locked" for the client.
 * @param {string} id
 * @param {object} data
 * @returns {Promise<object|null>}
 */
export async function updateCredential(id, data) {
  const allowed = {};
  for (const f of ['title', 'type', 'description', 'issued_at', 'expires_at', 'issuer_id', 'issuer_name', 'jurisdiction_id', 'document_url']) {
    if (data[f] !== undefined) allowed[f] = data[f];
  }
  // Switching issuer mode: clear whichever of issuer_id/issuer_name isn't
  // the one being set, so a credential never ends up with both a linked
  // org and stale free-text issuer name (or vice versa).
  if (allowed.issuer_id !== undefined) allowed.issuer_name = null;
  else if (allowed.issuer_name !== undefined) allowed.issuer_id = null;

  return Credential.findByIdAndUpdate(id, allowed, { new: true, runValidators: true }).lean();
}

/**
 * Permanently delete a credential. No soft-delete field exists on this
 * model (unlike Education/WorkExperience) — this is a real hard delete.
 * @param {string} id
 * @returns {Promise<boolean>} true if a document was deleted
 */
export async function deleteCredential(id) {
  const res = await Credential.deleteOne({ _id: id });
  return res.deletedCount > 0;
}

/**
 * Holder-triggered: flag a credential as awaiting admin review. Does not
 * verify it — only surfaces it (sorted first) in the admin pending queue.
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function requestVerification(id) {
  return Credential.findByIdAndUpdate(
    id,
    { verification_requested_at: new Date() },
    { new: true }
  ).lean();
}

/**
 * Mark a credential as verified. Admin-only action (enforced by the route).
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function markVerified(id) {
  return Credential.findByIdAndUpdate(id, { verified: true }, { new: true }).lean();
}

/**
 * Find all not-yet-verified credentials across every holder, for admin
 * review. Credentials with a pending holder request are surfaced first.
 *
 * Sorts by created_at only in the DB query — Cosmos DB for MongoDB needs a
 * composite index for a compound sort key, which this collection doesn't
 * have — then reorders requested-first in application code instead.
 * @param {object} [filters] - { limit?, offset? }
 * @returns {Promise<{ rows: object[], total: number }>}
 */
export async function findAllPending(filters = {}) {
  // $ne (not $eq false) so credentials that predate the `verified` field
  // (and so have it entirely absent, not stored as false) are still
  // treated as pending rather than silently excluded from the queue.
  const q = { verified: { $ne: true } };
  const total = await Credential.countDocuments(q);
  const limit = filters.limit || 20;
  const skip = filters.offset || 0;

  const rows = await Credential.find(q)
    .sort({ created_at: -1 })
    .skip(skip)
    .limit(limit)
    .populate('holder_id', 'full_name email')
    .lean();

  rows.sort((a, b) => Boolean(b.verification_requested_at) - Boolean(a.verification_requested_at));

  return { rows, total };
}

/**
 * Get a credential populated with its issuer organisation (and the issuer's
 * own jurisdiction). Returned as `issuer`/`jurisdiction` (not `issuer_id`/
 * `jurisdiction_id`) to match what verifyCredential() and the credential
 * detail page expect.
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getCredentialWithIssuer(id) {
  const doc = await Credential.findById(id)
    .populate({
      path: 'issuer_id',
      select: 'name did type verified jurisdiction_id public_key_jwk',
      populate: { path: 'jurisdiction_id', select: 'country_code country_name' },
    })
    .populate('jurisdiction_id', 'country_code country_name')
    .lean();

  if (!doc) return null;

  const { issuer_id, jurisdiction_id, ...rest } = doc;
  const issuer = issuer_id
    ? (() => {
        const { jurisdiction_id: issuerJurisdiction, ...issuerRest } = issuer_id;
        return { ...issuerRest, jurisdiction: issuerJurisdiction || null };
      })()
    : null;

  return { ...rest, issuer, jurisdiction: jurisdiction_id || null };
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
