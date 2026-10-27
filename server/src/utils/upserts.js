import {
  Brand,
  Drug,
  Manufacturer,
  Product,
  Signal,
} from '../models/index.js';
import { normalizeName } from './normalize.js';
import { fuzzyManufacturerMatch } from './fuzzy.js';

export async function findOrCreateManufacturer(name, defaults = {}) {
  const cleanName = typeof name === 'string' ? name.trim() : '';
  if (!cleanName) return null;

  const target = normalizeName(cleanName);
  const manufacturers = await Manufacturer.find({}).lean();

  const exact = manufacturers.find(
    (item) =>
      normalizeName(item.name) === target ||
      (item.aliases ?? []).some((alias) => normalizeName(alias) === target)
  );
  if (exact) return Manufacturer.findById(exact._id);

  const fuzzy = fuzzyManufacturerMatch(cleanName, manufacturers, 0.62);
  if (fuzzy) return Manufacturer.findById(fuzzy.manufacturer._id);

  return Manufacturer.create({
    name: cleanName,
    aliases: defaults.aliases ?? [],
    country: defaults.country,
    regulatoryTier: defaults.regulatoryTier ?? 'Unrated',
  });
}

export async function upsertDrug({ salt, strength, form, atcCode }) {
  return Drug.findOneAndUpdate(
    { salt, strength, form },
    { $set: { salt, strength, form, atcCode } },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );
}

export async function upsertBrand({ name, manufacturer, drug, source }) {
  return Brand.findOneAndUpdate(
    { name, manufacturer, drug },
    { $set: { name, manufacturer, drug, source } },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );
}

export async function upsertProduct({
  drug,
  manufacturer,
  brand,
  mrp,
  teCode,
  source,
}) {
  return Product.findOneAndUpdate(
    { drug, manufacturer, brand: brand ?? null },
    { $set: { drug, manufacturer, brand: brand ?? null, mrp, teCode, source } },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );
}

export async function upsertSignal(signal) {
  return Signal.findOneAndUpdate(
    { externalId: signal.externalId },
    { $set: signal },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );
}
