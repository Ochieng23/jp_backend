import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const educationSchema = new Schema(
  {
    holder_id: {
      type: Schema.Types.ObjectId,
      ref: 'PassportHolder',
      required: true,
      index: true,
    },
    institution_name: {
      type: String,
      required: [true, 'Institution name is required'],
      trim: true,
    },
    qualification: {
      type: String,
      required: [true, 'Qualification is required'],
      trim: true,
    },
    start_date: {
      type: Date,
      required: [true, 'Start date is required'],
    },
    end_date: {
      type: Date, // null = currently studying
    },
    is_current: {
      type: Boolean,
      default: false,
    },
    location: {
      type: String,
      trim: true,
    },
    jurisdiction_id: {
      type: Schema.Types.ObjectId,
      ref: 'Jurisdiction',
    },
    verified: {
      type: Boolean,
      default: false,
    },
    verification_credential_id: {
      type: Schema.Types.ObjectId,
      ref: 'Credential',
    },
    verification_requested_at: {
      type: Date,
      default: null,
    },
    description: {
      type: String,
    },
    document_url: {
      type: String, // base64 data URL or blob URL of supporting document (e.g. certificate/transcript)
    },
    deleted_at: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'created_at' },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

educationSchema.index({ holder_id: 1, deleted_at: 1 });

export default model('Education', educationSchema);
