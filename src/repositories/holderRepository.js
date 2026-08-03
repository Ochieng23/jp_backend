import { v4 as uuidv4 } from 'uuid';
import PassportHolder from '../models/PassportHolder.js';
import Credential from '../models/Credential.js';
import CredentialRecognition from '../models/CredentialRecognition.js';
import Education from '../models/Education.js';
import WorkExperience from '../models/WorkExperience.js';
import ShareLink from '../models/ShareLink.js';

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
 * Store a freshly generated email-verification token on a holder.
 * @param {string} id
 * @param {string} token
 * @param {Date} expires
 */
export async function setEmailVerificationToken(id, token, expires) {
  await PassportHolder.findByIdAndUpdate(id, {
    email_verification_token: token,
    email_verification_expires: expires,
  });
}

/**
 * Find a holder by an unexpired email-verification token.
 * @param {string} token
 * @returns {Promise<object|null>}
 */
export async function findHolderByVerificationToken(token) {
  const holder = await PassportHolder.findOne({
    email_verification_token: token,
    email_verification_expires: { $gt: new Date() },
  })
    .select('+email_verification_token +email_verification_expires')
    .lean();
  return omitUnhcrId(holder);
}

/**
 * Mark a holder's email verified and clear the verification token.
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function markEmailVerified(id) {
  return omitUnhcrId(
    await PassportHolder.findByIdAndUpdate(
      id,
      { email_verified: true, $unset: { email_verification_token: '', email_verification_expires: '' } },
      { new: true }
    ).lean()
  );
}

/**
 * Store a freshly generated password-reset token on a holder.
 * @param {string} id
 * @param {string} token
 * @param {Date} expires
 */
export async function setPasswordResetToken(id, token, expires) {
  await PassportHolder.findByIdAndUpdate(id, {
    password_reset_token: token,
    password_reset_expires: expires,
  });
}

/**
 * Find a holder by an unexpired password-reset token.
 * @param {string} token
 * @returns {Promise<object|null>}
 */
export async function findHolderByResetToken(token) {
  const holder = await PassportHolder.findOne({
    password_reset_token: token,
    password_reset_expires: { $gt: new Date() },
  })
    .select('+password_reset_token +password_reset_expires')
    .lean();
  return omitUnhcrId(holder);
}

/**
 * Set a new password hash and clear the reset token.
 * @param {string} id
 * @param {string} passwordHash
 */
export async function resetPassword(id, passwordHash) {
  await PassportHolder.findByIdAndUpdate(id, {
    password_hash: passwordHash,
    $unset: { password_reset_token: '', password_reset_expires: '' },
  });
}

/**
 * Update allowed profile fields. Does NOT allow changing email or password
 * (or unhcr_id, which isn't a client-settable field at all).
 * @param {string} id
 * @param {object} data - { full_name?, phone?, nationality?, date_of_birth?, avatar_key?, intro_video_url?, bio?, industries?, open_to_any_industry? }
 * @returns {Promise<object|null>} Updated holder
 */
export async function updateHolder(id, data) {
  const allowed = {};
  for (const f of ['full_name', 'phone', 'nationality', 'date_of_birth', 'avatar_key', 'intro_video_url', 'bio', 'industries', 'open_to_any_industry']) {
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
 * Find all holders with optional name/email search, paginated. Admin-only
 * listing (enforced by the route) — no unhcr_id stripping needed since
 * this never returns password_hash and admins already see full profiles.
 * @param {object} [filters] - { search?, limit?, offset? }
 * @returns {Promise<{ rows: object[], total: number }>}
 */
export async function findAll(filters = {}) {
  const q = {};
  if (filters.search) {
    q.$or = [
      { full_name: { $regex: filters.search, $options: 'i' } },
      { email: { $regex: filters.search, $options: 'i' } },
    ];
  }

  const total = await PassportHolder.countDocuments(q);
  const limit = filters.limit || 20;
  const skip = filters.offset || 0;

  const rows = await PassportHolder.find(q)
    .sort({ created_at: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return { rows: rows.map(omitUnhcrId), total };
}

/**
 * Change a holder's role. Admin-only action (enforced by the route).
 * @param {string} id
 * @param {'holder'|'org_admin'|'platform_admin'} role
 * @returns {Promise<object|null>}
 */
export async function updateRole(id, role) {
  return omitUnhcrId(
    await PassportHolder.findByIdAndUpdate(id, { role }, { new: true, runValidators: true }).lean()
  );
}

/**
 * Get a holder's complete data — profile plus every credential, education,
 * and work experience record, with no status/verified/deleted filtering.
 * Admin-only (enforced by the route): unlike the holder's own dashboard
 * views, this is meant to show everything, including revoked credentials
 * and soft-deleted entries, so an admin can see the full picture.
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getFullProfile(id) {
  const holder = omitUnhcrId(await PassportHolder.findById(id).lean());
  if (!holder) return null;

  const [credentials, education, workExperience] = await Promise.all([
    Credential.find({ holder_id: id }).sort({ created_at: -1 }).lean(),
    Education.find({ holder_id: id }).sort({ created_at: -1 }).lean(),
    WorkExperience.find({ holder_id: id }).sort({ created_at: -1 }).lean(),
  ]);

  return { holder, credentials, education, work_experience: workExperience };
}

/**
 * Permanently delete a holder and every record that belongs to them
 * (credentials, education, work experience, share links). Admin-only,
 * irreversible (enforced/confirmed by the route and frontend).
 * @param {string} id
 * @returns {Promise<boolean>} true if the holder existed and was deleted
 */
export async function deleteHolder(id) {
  const holder = await PassportHolder.findById(id);
  if (!holder) return false;

  await Promise.all([
    Credential.deleteMany({ holder_id: id }),
    Education.deleteMany({ holder_id: id }),
    WorkExperience.deleteMany({ holder_id: id }),
    ShareLink.deleteMany({ holder_id: id }),
  ]);
  await PassportHolder.deleteOne({ _id: id });
  return true;
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
