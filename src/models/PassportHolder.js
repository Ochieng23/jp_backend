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
      // Optional at registration — collected later when the holder builds
      // out their profile (see PATCH /passport/me).
    },
    nationality: {
      type: String,
      trim: true,
    },
    // Not a product feature (the platform serves all jobseekers, not only
    // refugees) — this field is never accepted from or returned to a
    // client. It still exists purely because Cosmos DB for MongoDB refuses
    // to drop/modify a unique index on a non-empty collection, and this
    // legacy index can't honor `sparse`, so holderRepository silently writes
    // a distinct `unset:<uuid>` sentinel here on every create to keep that
    // index from colliding across holders. Do not reintroduce this as a
    // visible field without also fixing the underlying index.
    unhcr_id: {
      type: String,
      trim: true,
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
    intro_video_url: {
      type: String, // Azure Blob URL of the holder's craft-explainer video (<=50MB)
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
    phone: this.phone,
    email: this.email,
    avatar_key: this.avatar_key,
    intro_video_url: this.intro_video_url,
    bio: this.bio,
    role: this.role,
    created_at: this.created_at,
  };
};

// ─── Indexes ──────────────────────────────────────────────────────────────
passportHolderSchema.index({ email: 1 }, { unique: true });
// unhcr_id: legacy unique index, kept only because Cosmos won't let it be
// dropped in place — see the field comment above.
passportHolderSchema.index({ unhcr_id: 1 }, { unique: true, sparse: true });

export default model('PassportHolder', passportHolderSchema);
