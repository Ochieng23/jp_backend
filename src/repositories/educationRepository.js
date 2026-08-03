import Education from '../models/Education.js';

export async function createEntry(data) {
  const entry = await Education.create(data);
  return entry.toObject();
}

export async function findByHolder(holderId) {
  return Education.find({ holder_id: holderId, deleted_at: null })
    .sort({ start_date: -1 })
    .populate('jurisdiction_id', 'country_code country_name')
    .lean();
}

export async function findById(id) {
  return Education.findOne({ _id: id, deleted_at: null }).lean();
}

export async function updateEntry(id, data, { bypassVerifiedLock = false } = {}) {
  const allowed = {};
  for (const f of ['institution_name', 'qualification', 'start_date', 'end_date', 'is_current', 'location', 'jurisdiction_id', 'description', 'document_url']) {
    if (data[f] !== undefined) allowed[f] = data[f];
  }
  const query = { _id: id, deleted_at: null };
  if (!bypassVerifiedLock) query.verified = false;
  return Education.findOneAndUpdate(query, allowed, { new: true, runValidators: true }).lean();
}

export async function softDelete(id) {
  return Education.findOneAndUpdate(
    { _id: id, deleted_at: null },
    { deleted_at: new Date() },
    { new: true }
  ).lean();
}

/**
 * Mark an entry as verified. Admin-only action (enforced by the route).
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function verifyEntry(id) {
  return Education.findOneAndUpdate(
    { _id: id, deleted_at: null },
    { verified: true },
    { new: true }
  ).lean();
}

/**
 * Holder-triggered: flag an entry as awaiting admin review. Does not
 * verify it — only surfaces it (sorted first) in the admin pending queue.
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function requestVerification(id) {
  return Education.findOneAndUpdate(
    { _id: id, deleted_at: null },
    { verification_requested_at: new Date() },
    { new: true }
  ).lean();
}

/**
 * Find all not-yet-verified entries across every holder, for admin review.
 * Entries with a pending holder request are surfaced first.
 * @param {object} [filters] - { limit?, offset? }
 * @returns {Promise<{ rows: object[], total: number }>}
 */
export async function findAllPending(filters = {}) {
  const q = { verified: false, deleted_at: null };
  const total = await Education.countDocuments(q);
  const limit = filters.limit || 20;
  const skip = filters.offset || 0;

  const rows = await Education.find(q)
    .sort({ created_at: -1 })
    .skip(skip)
    .limit(limit)
    .populate('holder_id', 'full_name email')
    .populate('jurisdiction_id', 'country_code country_name')
    .lean();

  rows.sort((a, b) => Boolean(b.verification_requested_at) - Boolean(a.verification_requested_at));

  return { rows, total };
}
