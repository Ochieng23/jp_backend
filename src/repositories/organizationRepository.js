import IssuingOrganization from '../models/IssuingOrganization.js';

/**
 * Create a new issuing organisation record.
 * @param {object} data - { name, type, did, public_key_jwk, jurisdiction_id? }
 * @returns {Promise<object>}
 */
export async function createOrg(data) {
  const org = await IssuingOrganization.create({ ...data, verified: false });
  return org.toObject();
}

/**
 * Find an organisation by its MongoDB _id, populated with jurisdiction.
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function findById(id) {
  return IssuingOrganization.findById(id)
    .populate('jurisdiction_id', 'country_code country_name')
    .lean();
}

/**
 * Find all organisations with optional filters and pagination.
 * @param {object} [filters] - { type?, verified?, jurisdiction_id?, limit?, offset? }
 * @returns {Promise<{ rows: object[], total: number }>}
 */
export async function findAll(filters = {}) {
  const q = {};
  if (filters.type) q.type = filters.type;
  if (filters.verified !== undefined) q.verified = filters.verified;
  if (filters.jurisdiction_id) q.jurisdiction_id = filters.jurisdiction_id;

  const total = await IssuingOrganization.countDocuments(q);
  const limit = filters.limit || 20;
  const skip = filters.offset || 0;

  const rows = await IssuingOrganization.find(q)
    .sort({ name: 1 })
    .skip(skip)
    .limit(limit)
    .populate('jurisdiction_id', 'country_code country_name')
    .lean();

  return { rows, total };
}

/**
 * Update mutable fields on an organisation.
 * @param {string} id
 * @param {object} data - { name?, type?, jurisdiction_id?, public_key_jwk? }
 * @returns {Promise<object|null>}
 */
export async function updateOrg(id, data) {
  const allowed = {};
  for (const f of ['name', 'type', 'jurisdiction_id', 'public_key_jwk']) {
    if (data[f] !== undefined) allowed[f] = data[f];
  }
  return IssuingOrganization.findByIdAndUpdate(id, allowed, {
    new: true,
    runValidators: true,
  })
    .populate('jurisdiction_id', 'country_code country_name')
    .lean();
}

/**
 * Mark an organisation as verified (platform_admin only).
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function verifyOrg(id) {
  return IssuingOrganization.findByIdAndUpdate(
    id,
    { verified: true },
    { new: true }
  ).lean();
}

/**
 * Find an organisation by its DID.
 * @param {string} did
 * @returns {Promise<object|null>}
 */
export async function findByDid(did) {
  return IssuingOrganization.findOne({ did }).lean();
}
