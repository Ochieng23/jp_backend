import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const credentialRecognitionSchema = new Schema(
  {
    source_credential_id: {
      type: Schema.Types.ObjectId,
      ref: 'Credential',
      required: true,
    },
    target_jurisdiction_id: {
      type: Schema.Types.ObjectId,
      ref: 'Jurisdiction',
      required: true,
    },
    equivalent_type: {
      type: String, // what the credential maps to in the target jurisdiction
    },
    recognition_status: {
      type: String,
      enum: ['recognised', 'partial', 'not_recognised', 'pending'],
      default: 'pending',
      index: true,
    },
    notes: {
      type: String,
    },
    evaluated_at: {
      type: Date,
    },
  },
  {
    timestamps: { createdAt: 'created_at' },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Enforce uniqueness: one recognition record per credential per jurisdiction
credentialRecognitionSchema.index(
  { source_credential_id: 1, target_jurisdiction_id: 1 },
  { unique: true }
);
credentialRecognitionSchema.index({ target_jurisdiction_id: 1 });

export default model('CredentialRecognition', credentialRecognitionSchema);
