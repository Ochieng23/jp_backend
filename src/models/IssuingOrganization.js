import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const issuingOrganizationSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Organisation name is required'],
      trim: true,
    },
    jurisdiction_id: {
      type: Schema.Types.ObjectId,
      ref: 'Jurisdiction',
      // index defined below via schema.index()
    },
    type: {
      type: String,
      required: true,
      enum: ['vocational', 'ngo', 'government', 'employer', 'academic'],
    },
    did: {
      type: String,
      required: [true, 'DID is required'],
      unique: true,
      trim: true,
    },
    public_key_jwk: {
      type: Schema.Types.Mixed, // JSON object
      required: [true, 'Public key JWK is required'],
    },
    verified: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: { createdAt: 'created_at' },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

issuingOrganizationSchema.index({ jurisdiction_id: 1 });
issuingOrganizationSchema.index({ verified: 1 });
issuingOrganizationSchema.index({ type: 1 });

export default model('IssuingOrganization', issuingOrganizationSchema);
