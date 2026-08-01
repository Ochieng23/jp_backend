import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const credentialSchema = new Schema(
  {
    holder_id: {
      type: Schema.Types.ObjectId,
      ref: 'PassportHolder',
      required: true,
      index: true,
    },
    issuer_id: {
      type: Schema.Types.ObjectId,
      ref: 'IssuingOrganization',
      // Optional — self-reported credentials without a registered issuing
      // organisation on the platform use issuer_name (free text) instead.
    },
    issuer_name: {
      type: String,
      trim: true, // free-text issuer, used when issuer_id isn't set
    },
    type: {
      type: String,
      required: [true, 'Credential type is required'],
      index: true,
      // e.g. 'VocationalCertificate', 'WorkHistory', 'LanguageTest'
    },
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
    },
    description: {
      type: String,
    },
    issued_at: {
      type: Date,
      required: [true, 'Issue date is required'],
    },
    expires_at: {
      type: Date,
    },
    status: {
      type: String,
      enum: ['active', 'revoked', 'suspended'],
      default: 'active',
      index: true,
    },
    vc_json: {
      type: Schema.Types.Mixed, // full W3C VC JSON-LD document
      required: true,
    },
    proof_value: {
      type: String, // detached JWS / ed25519 signature
      required: true,
    },
    document_url: {
      type: String, // Azure Blob URL of supporting document
    },
    document_key: {
      type: String, // Azure Blob name for deletion
    },
    jurisdiction_id: {
      type: Schema.Types.ObjectId,
      ref: 'Jurisdiction',
      // index defined below via schema.index()
    },
  },
  {
    timestamps: { createdAt: 'created_at' },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

credentialSchema.index({ holder_id: 1, status: 1 });
credentialSchema.index({ holder_id: 1, type: 1 });
credentialSchema.index({ jurisdiction_id: 1 });

export default model('Credential', credentialSchema);
