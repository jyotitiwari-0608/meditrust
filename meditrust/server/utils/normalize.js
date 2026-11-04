export function normalizeName(name) {
  if (!name) return "";
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeComposition(composition) {
  if (!composition) return { salt: "", strength: "", form: "" };
  const text = String(composition).toLowerCase();
  // crude salt + strength split, e.g. "amlodipine 5 mg tablet"
  const parts = text.trim().split(/\s+/);
  const salt = parts[0] || "";
  const strengthIdx = parts.findIndex((p) => /\d/.test(p));
  const strength = strengthIdx > -1 ? parts.slice(strengthIdx).join(" ") : "";
  const formMatch = text.match(/\b(tablet|capsule|syrup|injection|suspension)\b/);
  const form = formMatch ? formMatch[1] : "tablet";
  return { salt, strength, form };
}
