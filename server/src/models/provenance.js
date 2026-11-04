import mongoose from 'mongoose';

const { Schema } = mongoose;

export const provenanceSchema = new Schema(
  {
    sourceName: { type: String, required: true, trim: true },
    sourceUrl: { type: String, required: true, trim: true },
    sourceDate: { type: Date, required: true },
  },
  { _id: false }
);
