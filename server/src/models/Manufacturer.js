import mongoose from 'mongoose';

const { Schema } = mongoose;

const manufacturerSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    aliases: { type: [String], default: [] },
    country: { type: String, trim: true },
    regulatoryTier: {
      type: String,
      enum: ['Tier 1', 'Tier 2', 'Tier 3', 'Unrated'],
      default: 'Unrated',
    },
  },
  { timestamps: true }
);

manufacturerSchema.index(
  { name: 'text', aliases: 'text' },
  { weights: { name: 10, aliases: 5 }, name: 'manufacturer_text_search' }
);

export const Manufacturer = mongoose.model('Manufacturer', manufacturerSchema);
export default Manufacturer;
