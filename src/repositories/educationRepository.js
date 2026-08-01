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

export async function updateEntry(id, data) {
  const allowed = {};
  for (const f of ['institution_name', 'qualification', 'start_date', 'end_date', 'is_current', 'location', 'jurisdiction_id', 'description']) {
    if (data[f] !== undefined) allowed[f] = data[f];
  }
  return Education.findOneAndUpdate(
    { _id: id, deleted_at: null, verified: false },
    allowed,
    { new: true, runValidators: true }
  ).lean();
}

export async function softDelete(id) {
  return Education.findOneAndUpdate(
    { _id: id, deleted_at: null },
    { deleted_at: new Date() },
    { new: true }
  ).lean();
}
