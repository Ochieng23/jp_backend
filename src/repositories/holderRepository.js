import { v4 as uuidv4 } from 'uuid';
import PassportHolder from '../models/PassportHolder.js';
import Credential from '../models/Credential.js';
import CredentialRecognition from '../models/CredentialRecognition.js';

// ─── unhcr_id: internal-only index workaround ──────────────────────────────
//
// unhcr_id is not a product feature (the platform serves all jobseekers, not
// only refugees) and is never accepted from or returned to a client. It
// still exists as a hidden field purely because its legacy unique index
// can't be dropped or fixed in place: Cosmos DB for MongoDB doesn't honor
// `sparse` on unique indexes, so two holders both lacking the field would
// otherwise collide (E11000) on the shared "missing" slot, and Cosmos
// refuses to modify a unique index on a non-empty collection. Every holder
// gets a distinct sentinel value here so that legacy index never collides.
function newUnhcrSentinel() {
  return `unset:${uuidv4()}`;
}

/** Strips the internal-only unhcr_id field from a lean holder object in place. */
function omitUnhcrId(holder) {
  if (holder) delete holder.unhcr_id;
  return holder;
}

/**
 * Create a new passport holder.
 * password_hash field contains the plaintext password here;
 * the Mongoose pre-save hook hashes it automatically.
 *
 * @param {object} data - { full_name, date_of_birth, nationality, email, password_hash, phone? }
 * @returns {Promise<object>} Public holder object (no password_hash, no unhcr_id)
 */
export async function createHolder(data) {
  const holder = await PassportHolder.create({ ...data, unhcr_id: newUnhcrSentinel() });
  const pub = holder.toPublic();
  delete pub.unhcr_id;
  return pub;
}

/**
 * Find a holder by email, including the password_hash field for authentication.
 * @param {string} email
 * @returns {Promise<object|null>}
 */
export async function findHolderByEmail(email) {
  const holder = await PassportHolder.findOne({ email: email.toLowerCase() })
    .select('+password_hash')
    .lean();
  return omitUnhcrId(holder);
}

/**
 * Find a holder by their MongoDB _id.
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function findHolderById(id) {
  return omitUnhcrId(await PassportHolder.findById(id).lean());
}

/**
 * Update allowed profile fields. Does NOT allow changing email or password
 * (or unhcr_id, which isn't a client-settable field at all).
 * @param {string} id
 * @param {object} data - { full_name?, phone?, nationality?, date_of_birth?, avatar_key?, intro_video_url?, bio? }
 * @returns {Promise<object|null>} Updated holder
 */
export async function updateHolder(id, data) {
  const allowed = {};
  for (const f of ['full_name', 'phone', 'nationality', 'date_of_birth', 'avatar_key', 'intro_video_url', 'bio']) {
    if (data[f] !== undefined) allowed[f] = data[f];
  }
  return omitUnhcrId(
    await PassportHolder.findByIdAndUpdate(id, allowed, {
      new: true,
      runValidators: true,
    }).lean()
  );
}

/**
 * Get a holder's full profile with credential summary (by type) and active jurisdictions.
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getHolderWithCredentialSummary(id) {
  const holder = await PassportHolder.findById(id).lean();
  if (!holder) return null;

  // Credential counts grouped by type
  const typeCounts = await Credential.aggregate([
    { $match: { holder_id: holder._id, status: 'active' } },
    { $group: { _id: '$type', count: { $sum: 1 } } },
  ]);

  // Active jurisdictions — unique targets with recognition_status = 'recognised'
  const credIds = await Credential.find({ holder_id: holder._id }).distinct('_id');
  const activeJurisdictionIds = await CredentialRecognition.find({
    source_credential_id: { $in: credIds },
    recognition_status: 'recognised',
  }).distinct('target_jurisdiction_id');

  const result = {
    ...holder,
    id: holder._id,
    credential_summary: typeCounts.map((t) => ({ type: t._id, count: t.count })),
    jurisdictions_active: activeJurisdictionIds,
  };
  delete result.unhcr_id;
  return result;
}
