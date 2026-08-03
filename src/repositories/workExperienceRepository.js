import WorkExperience from '../models/WorkExperience.js';

export async function createEntry(data) {
  const entry = await WorkExperience.create(data);
  return entry.toObject();
}

export async function findByHolder(holderId) {
  return WorkExperience.find({ holder_id: holderId, deleted_at: null })
    .sort({ start_date: -1 })
    .populate('jurisdiction_id', 'country_code country_name')
    .lean();
}

export async function findById(id) {
  return WorkExperience.findOne({ _id: id, deleted_at: null }).lean();
}

export async function updateEntry(id, data) {
  const allowed = {};
  for (const f of ['employer_name', 'job_title', 'start_date', 'end_date', 'is_current', 'location', 'jurisdiction_id', 'description', 'document_url']) {
    if (data[f] !== undefined) allowed[f] = data[f];
  }
  return WorkExperience.findOneAndUpdate(
    { _id: id, deleted_at: null, verified: false },
    allowed,
    { new: true, runValidators: true }
  ).lean();
}

export async function softDelete(id) {
  return WorkExperience.findOneAndUpdate(
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
  return WorkExperience.findOneAndUpdate(
    { _id: id, deleted_at: null },
    { verified: true },
    { new: true }
  ).lean();
}

/**
 * Find all not-yet-verified entries across every holder, for admin review.
 * @param {object} [filters] - { limit?, offset? }
 * @returns {Promise<{ rows: object[], total: number }>}
 */
export async function findAllPending(filters = {}) {
  const q = { verified: false, deleted_at: null };
  const total = await WorkExperience.countDocuments(q);
  const limit = filters.limit || 20;
  const skip = filters.offset || 0;

  const rows = await WorkExperience.find(q)
    .sort({ created_at: -1 })
    .skip(skip)
    .limit(limit)
    .populate('holder_id', 'full_name email')
    .populate('jurisdiction_id', 'country_code country_name')
    .lean();

  return { rows, total };
}
