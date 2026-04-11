import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const shareLinkSchema = new Schema(
  {
    holder_id: { type: Schema.Types.ObjectId, ref: 'PassportHolder', required: true, index: true },
    token: { type: String, required: true },
    slug: { type: String, required: true, unique: true, index: true },
    expires_at: { type: Date, required: true },
  },
  { timestamps: { createdAt: 'created_at' }, toJSON: { virtuals: true } }
);

export default model('ShareLink', shareLinkSchema);
