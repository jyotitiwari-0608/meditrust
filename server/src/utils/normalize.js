const LEGAL_SUFFIXES = new Set([
  'ltd',
  'limited',
  'pvt',
  'private',
  'inc',
  'incorporated',
  'corp',
  'corporation',
  'co',
  'company',
  'llc',
  'llp',
  'plc',
  'pharmaceuticals',
  'pharmaceutical',
  'pharma',
  'laboratories',
  'laboratory',
  'labs',
  'healthcare',
  'health',
  'care',
  'generics',
  'industries',
  'enterprises',
  'international',
  'group',
]);

const SALT_FORM_WORDS = new Set([
  'hcl',
  'hydrochloride',
  'sodium',
  'potassium',
  'calcium',
  'besylate',
  'maleate',
  'tartrate',
  'mesylate',
  'succinate',
  'fumarate',
  'dihydrate',
  'monohydrate',
  'anhydrous',
]);

export function normalizeName(value) {
  if (value === null || value === undefined) return '';

  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token && !LEGAL_SUFFIXES.has(token))
    .join(' ')
    .trim();
}

export function normalizeSalt(value) {
  if (value === null || value === undefined) return '';

  return normalizeName(value)
    .split(/\s+/)
    .filter((token) => token && !SALT_FORM_WORDS.has(token))
    .join(' ')
    .trim();
}

export function normalizeStrength(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*\/\s*/g, '/')
    .trim();
}

export function normalizeForm(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase();
}
