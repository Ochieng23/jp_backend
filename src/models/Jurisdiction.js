import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * recognition_rules structure:
 * {
 *   "VocationalCertificate": {
 *     "equivalent_type": "TradeQualification",
 *     "default_status": "partial",
 *     "notes": "Requires local assessment"
 *   }
 * }
 */
const jurisdictionSchema = new Schema(
  {
    country_code: {
      type: String,
      required: [true, 'Country code is required'],
      uppercase: true,
      trim: true,
      minlength: 3,
      maxlength: 3,
    },
    country_name: {
      type: String,
      required: [true, 'Country name is required'],
      trim: true,
    },
    // Free-form object: { "VocationalCertificate": { equivalent_type, default_status, notes } }
    // Using Mixed so callers can access rules[credentialType] directly on lean() results.
    recognition_rules: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: { createdAt: 'created_at' },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

jurisdictionSchema.index({ country_code: 1 }, { unique: true });

export default model('Jurisdiction', jurisdictionSchema);
