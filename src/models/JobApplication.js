import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * Local record of a holder's application to a kazini_backend job.
 * kazini_backend's own Application model has no field linking back to the
 * submitting holder, so this collection is how the holder sees "my applications".
 */
const jobApplicationSchema = new Schema(
  {
    holder_id: {
      type: Schema.Types.ObjectId,
      ref: 'PassportHolder',
      required: true,
      index: true,
    },
    kazini_job_id: {
      type: String,
      required: true,
    },
    kazini_application_id: {
      type: String,
      required: true,
    },
    kazini_employer_id: {
      type: String,
    },
    job_title: {
      type: String,
      required: true,
    },
    employer_name: {
      type: String,
    },
    status: {
      type: String,
      default: 'Applied',
    },
    applied_at: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: { createdAt: 'created_at' },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

jobApplicationSchema.index({ holder_id: 1, kazini_job_id: 1 }, { unique: true });

export default model('JobApplication', jobApplicationSchema);
