import AuditLog from '../models/AuditLog.js';
import Credential from '../models/Credential.js';
import IssuingOrganization from '../models/IssuingOrganization.js';
import Jurisdiction from '../models/Jurisdiction.js';
import Education from '../models/Education.js';
import WorkExperience from '../models/WorkExperience.js';

/**
 * Insert a new audit log entry.
 * @param {object} data
 * @returns {Promise<object>}
 */
export async function logAction(data) {
  const entry = await AuditLog.create({
    actor_id: data.actor_id || null,
    actor_type: data.actor_type || 'admin',
    action: data.action,
    resource_type: data.resource_type,
    resource_id: data.resource_id,
    metadata: data.metadata || null,
    jurisdiction_id: data.jurisdiction_id || null,
    ip_address: data.ip_address || null,
  });
  return entry.toObject();
}

/**
 * Find audit log entries for a specific actor, newest first, paginated.
 * @param {string} actorId
 * @param {object} [pagination] - { limit?, offset? }
 * @returns {Promise<{ rows: object[], total: number }>}
 */
export async function findByActor(actorId, pagination = {}) {
  const limit = pagination.limit || 20;
  const skip = pagination.offset || 0;
  const total = await AuditLog.countDocuments({ actor_id: actorId });
  const rows = await AuditLog.find({ actor_id: actorId })
    .sort({ created_at: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
  return { rows, total };
}

/**
 * Find all audit log entries with optional filters and pagination.
 * @param {object} [filters] - { actor_type?, action?, resource_type?, from?, to? }
 * @param {object} [pagination] - { limit?, offset? }
 * @returns {Promise<{ rows: object[], total: number }>}
 */
export async function findAll(filters = {}, pagination = {}) {
  const q = {};
  if (filters.actor_type) q.actor_type = filters.actor_type;
  if (filters.action) q.action = { $regex: filters.action, $options: 'i' };
  if (filters.resource_type) q.resource_type = filters.resource_type;
  if (filters.from || filters.to) {
    q.created_at = {};
    if (filters.from) q.created_at.$gte = new Date(filters.from);
    if (filters.to) q.created_at.$lte = new Date(filters.to);
  }

  const total = await AuditLog.countDocuments(q);
  const limit = pagination.limit || 20;
  const skip = pagination.offset || 0;
  const rows = await AuditLog.find(q)
    .sort({ created_at: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return { rows, total };
}

/**
 * Get aggregate statistics from the audit log.
 * @returns {Promise<object>}
 */
export async function getStats() {
  const [
    byActorType,
    byAction,
    byResourceType,
    holderCount,
    totalCredentialCount,
    activeCredentialCount,
    totalOrgCount,
    verifiedOrgCount,
    jurisdictionCount,
    pendingEducationCount,
    pendingWorkExperienceCount,
    pendingCredentialCount,
  ] = await Promise.all([
    AuditLog.aggregate([
      { $group: { _id: '$actor_type', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    AuditLog.aggregate([
      { $group: { _id: '$action', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ]),
    AuditLog.aggregate([
      { $group: { _id: '$resource_type', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    // Dynamic platform-level stats
    import('../models/PassportHolder.js').then((m) => m.default.countDocuments()),
    Credential.countDocuments(),
    Credential.countDocuments({ status: 'active' }),
    IssuingOrganization.countDocuments(),
    IssuingOrganization.countDocuments({ verified: true }),
    Jurisdiction.countDocuments(),
    Education.countDocuments({ verified: false, deleted_at: null }),
    WorkExperience.countDocuments({ verified: false, deleted_at: null }),
    // $ne (not $eq false) so credentials that predate the `verified` field
    // (entirely absent, not stored as false) still count as pending.
    Credential.countDocuments({ verified: { $ne: true } }),
  ]);

  return {
    platform: {
      total_holders: holderCount,
      total_credentials: totalCredentialCount,
      active_credentials: activeCredentialCount,
      total_organizations: totalOrgCount,
      verified_organizations: verifiedOrgCount,
      total_jurisdictions: jurisdictionCount,
      pending_verifications: {
        education: pendingEducationCount,
        work_experience: pendingWorkExperienceCount,
        credentials: pendingCredentialCount,
        total: pendingEducationCount + pendingWorkExperienceCount + pendingCredentialCount,
      },
    },
    by_actor_type: byActorType.map((r) => ({ actor_type: r._id, count: r.count })),
    by_action: byAction.map((r) => ({ action: r._id, count: r.count })),
    by_resource_type: byResourceType.map((r) => ({ resource_type: r._id, count: r.count })),
  };
}
