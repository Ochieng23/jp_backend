import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const workExperienceSchema = new Schema(
  {
    holder_id: {
      type: Schema.Types.ObjectId,
      ref: 'PassportHolder',
      required: true,
      index: true,
    },
    employer_name: {
      type: String,
      required: [true, 'Employer name is required'],
      trim: true,
    },
    job_title: {
      type: String,
      required: [true, 'Job title is required'],
      trim: true,
    },
    start_date: {
      type: Date,
      required: [true, 'Start date is required'],
    },
    end_date: {
      type: Date, // null = currently employed
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
    description: {
      type: String,
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

workExperienceSchema.index({ holder_id: 1, deleted_at: 1 });

export default model('WorkExperience', workExperienceSchema);
