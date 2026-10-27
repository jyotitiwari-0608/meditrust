import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeSalt } from './normalize.js';

const CONFIG_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../config'
);

export function loadConfig(name) {
  return JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, `${name}.json`), 'utf8'));
}

const pilot = loadConfig('pilot');
const pilotIndex = new Map();

for (const entry of pilot.salts) {
  pilotIndex.set(normalizeSalt(entry.salt), entry);
  for (const alias of entry.aliases ?? []) {
    pilotIndex.set(normalizeSalt(alias), entry);
  }
}

export function pilotEntries() {
  return pilot.salts;
}

export function findPilotSalt(rawSalt) {
  if (!rawSalt) return null;
  return pilotIndex.get(normalizeSalt(rawSalt)) ?? null;
}

export function isPilotSalt(rawSalt) {
  return Boolean(findPilotSalt(rawSalt));
}

export function pilotAtcCode(rawSalt) {
  return findPilotSalt(rawSalt)?.atcCode ?? null;
}

export function loadWeights() {
  return loadConfig('weights');
}

export function loadReference() {
  return loadConfig('reference');
}

export function loadNarrowTherapeuticIndex() {
  return loadConfig('narrowTherapeuticIndex');
}
