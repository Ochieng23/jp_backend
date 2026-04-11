import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const auditLogSchema = new Schema(
  {
    actor_id: {
      type: Schema.Types.ObjectId, // holder, org, or admin _id
    },
    actor_type: {
      type: String,
      enum: ['holder', 'organization', 'admin'],
    },
    action: {
      type: String,
      required: true,
      // e.g. 'credential.issued', 'credential.revoked', 'passport.viewed'
    },
    resource_type: {
      type: String,
      required: true,
    },
    resource_id: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    metadata: {
      type: Schema.Types.Mixed, // { before, after } or other context
    },
    jurisdiction_id: {
      type: Schema.Types.ObjectId,
      ref: 'Jurisdiction',
    },
    ip_address: {
      type: String,
    },
  },
  {
    timestamps: { createdAt: 'created_at' },
    // Audit logs are append-only — no updatedAt needed
  }
);

auditLogSchema.index({ actor_id: 1 });
auditLogSchema.index({ resource_id: 1 });
auditLogSchema.index({ action: 1 });
auditLogSchema.index({ created_at: -1 });

export default model('AuditLog', auditLogSchema);
