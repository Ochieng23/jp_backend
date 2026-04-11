import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const { Schema, model } = mongoose;

const passportHolderSchema = new Schema(
  {
    full_name: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true,
      maxlength: [120, 'Name must be at most 120 characters'],
    },
    date_of_birth: {
      type: Date,
      required: [true, 'Date of birth is required'],
    },
    nationality: {
      type: String,
      required: [true, 'Nationality is required'],
      trim: true,
    },
    unhcr_id: {
      type: String,
      trim: true,
      // unique sparse index defined below via schema.index()
    },
    phone: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Invalid email address'],
    },
    password_hash: {
      type: String,
      required: true,
      select: false, // excluded from queries by default
    },
    avatar_key: {
      type: String, // MinIO / Azure object key or base64 data URI
    },
    bio: {
      type: String,
      trim: true,
      maxlength: [600, 'Bio must be at most 600 characters'],
    },
    role: {
      type: String,
      enum: ['holder', 'org_admin', 'platform_admin'],
      default: 'holder',
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// NOTE: password hashing is done explicitly in the auth route (bcrypt.hash, cost 12)
// before createHolder() is called. The pre-save hook is intentionally omitted to
// avoid double-hashing.

// ─── Instance methods ─────────────────────────────────────────────────────
passportHolderSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password_hash);
};

passportHolderSchema.methods.toPublic = function () {
  return {
    id: this._id,
    full_name: this.full_name,
    date_of_birth: this.date_of_birth,
    nationality: this.nationality,
    unhcr_id: this.unhcr_id,
    phone: this.phone,
    email: this.email,
    avatar_key: this.avatar_key,
    bio: this.bio,
    role: this.role,
    created_at: this.created_at,
  };
};

// ─── Indexes ──────────────────────────────────────────────────────────────
// email unique + unhcr_id sparse-unique defined at field level above
passportHolderSchema.index({ email: 1 }, { unique: true });
passportHolderSchema.index({ unhcr_id: 1 }, { unique: true, sparse: true });

export default model('PassportHolder', passportHolderSchema);
