import { findPilotSalt } from './config.js';

const FORM_PATTERNS = [
  ['Tablet', /\b(tablet|tab|tabs)\b/i],
  ['Capsule', /\b(capsule|cap|caps)\b/i],
  ['Syrup', /\b(syrup|syr)\b/i],
  ['Suspension', /\b(suspension|susp)\b/i],
  ['Injection', /\b(injection|inj|vial|ampoule)\b/i],
  ['Infusion', /\b(infusion|iv fluid)\b/i],
  ['Ointment', /\b(ointment|oint)\b/i],
  ['Cream', /\b(cream)\b/i],
  ['Gel', /\b(gel)\b/i],
  ['Drops', /\b(drops|drop)\b/i],
  ['Inhaler', /\b(inhaler|inhalation)\b/i],
  ['Patch', /\b(patch)\b/i],
  ['Suppository', /\b(suppository|supp)\b/i],
  ['Solution', /\b(solution|soln)\b/i],
  ['Powder', /\b(powder|powd)\b/i],
  ['Granules', /\b(granules|granule)\b/i],
  ['Sachet', /\b(sachet)\b/i],
  ['Spray', /\b(spray)\b/i],
  ['Lotion', /\b(lotion)\b/i],
  ['Emulsion', /\b(emulsion)\b/i],
];

const STRENGTH_PATTERN =
  /(\d+(?:\.\d+)?)\s*(mg\/\s*5\s*ml|mcg\/\s*ml|mg\/\s*ml|mg|mcg|µg|ug|g|ml|iu|%)\b/i;

const STRENGTH_WORDS = new Set([
  'ip',
  'bp',
  'usp',
  'usnf',
  'ep',
  'ph',
  'eur',
]);

export function parsePrice(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (value === null || value === undefined) return null;

  const cleaned = String(value).replace(/[^0-9.]/g, '');
  if (!cleaned) return null;

  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseStrength(text) {
  if (!text) return null;
  const match = String(text).match(STRENGTH_PATTERN);
  if (!match) return null;

  const amount = Number.parseFloat(match[1]);
  const unit = match[2].toLowerCase().replace(/\s+/g, '').replace('ug', 'mcg');
  return `${amount} ${unit}`;
}

export function parseForm(text) {
  if (!text) return null;
  for (const [form, pattern] of FORM_PATTERNS) {
    if (pattern.test(text)) return form;
  }
  return null;
}

function cleanSaltText(component) {
  return component
    .replace(/\([^)]*\)/g, ' ')
    .replace(STRENGTH_PATTERN, ' ')
    .replace(
      /\b(tablet|tab|tabs|capsule|cap|caps|syrup|syr|suspension|susp|injection|inj|vial|ampoule|infusion|ointment|oint|cream|gel|drops|drop|inhaler|inhalation|patch|suppository|supp|solution|soln|powder|powd|granules|granule|sachet|spray|lotion|emulsion)\b/gi,
      ' '
    )
    .replace(/\b\d+(?:\.\d+)?\s*(mg\/\s*5\s*ml|mcg\/\s*ml|mg\/\s*ml|mg|mcg|µg|ug|g|ml|iu|%)\b/gi, ' ')
    .split(/\s+/)
    .filter((token) => token && !STRENGTH_WORDS.has(token.toLowerCase()))
    .join(' ')
    .trim();
}

export function parseComposition(composition, fallback = {}) {
  if (!composition) return null;

  const text = String(composition).replace(/\s+/g, ' ').trim();
  const components = text.split(/\s*\+\s*|\s*;\s*/);

  for (const component of components) {
    const rawSalt = cleanSaltText(component);
    const entry = findPilotSalt(rawSalt);
    if (!entry) continue;

    const strength = parseStrength(component) ?? fallback.strength ?? null;
    const form = parseForm(component) ?? fallback.form ?? null;

    return {
      salt: entry.salt,
      atcCode: entry.atcCode,
      strength,
      form,
      rawSalt,
      pilot: entry,
    };
  }

  return null;
}

function matchField(block, patterns) {
  for (const pattern of patterns) {
    const match = block.match(pattern);
    if (match) return match[1].trim().replace(/\s+/g, ' ');
  }
  return null;
}

export function splitNsqRows(text) {
  if (!text) return [];

  const normalized = String(text).replace(/\r\n?/g, '\n');
  let blocks = normalized
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length < 2) {
    const lines = normalized
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const grouped = [];
    let current = [];

    for (const line of lines) {
      const startsBatch = /batch\s*(?:no\.?|number)?/i.test(line);
      if (startsBatch && current.some((item) => /batch\s*(?:no\.?|number)?/i.test(item))) {
        grouped.push(current.join('\n'));
        current = [];
      }
      current.push(line);
    }
    if (current.length) grouped.push(current.join('\n'));
    blocks = grouped;
  }

  const rows = [];

  for (const block of blocks) {
    const batch = matchField(block, [
      /batch\s*(?:no\.?|number)?\s*[:\-]?\s*([A-Za-z0-9/_.\-]+)/i,
    ]);

    let drug = matchField(block, [
      /(?:name of (?:the )?drug|drug name|product name|name of product)\s*[:\-]\s*([^\n]+)/i,
      /(?:name of (?:the )?medicine|medicine name)\s*[:\-]\s*([^\n]+)/i,
    ]);

    let manufacturer = matchField(block, [
      /(?:name of (?:the )?manufacturer|manufacturer(?:'s)? name|manufacturer|mfg\.? by|manufactured by)\s*[:\-]\s*([^\n]+)/i,
    ]);

    let reason = matchField(block, [
      /(?:reason(?: for (?:the )?failure)?|remarks?|failure)\s*[:\-]\s*([^\n]+)/i,
    ]);

    if (!drug || !manufacturer || !reason) {
      const columns = block
        .split('\n')[0]
        .split(/\s{2,}|\t+/)
        .map((part) => part.trim())
        .filter(Boolean);
      if (columns.length >= 2) {
        drug = drug ?? columns[0];
        manufacturer = manufacturer ?? columns[1];
        reason = reason ?? columns.slice(2).join(' ') ?? null;
      }
    }

    if (!batch) continue;

    rows.push({
      drug: drug ?? null,
      batch,
      manufacturer: manufacturer ?? null,
      reason: reason ?? null,
      rawText: block,
    });
  }

  return rows;
}
