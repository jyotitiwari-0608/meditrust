import { search } from 'fast-fuzzy';

export function fuzzyManufacturerMatch(name, manufacturers, threshold = 0.55) {
  if (!name || !Array.isArray(manufacturers) || manufacturers.length === 0) {
    return null;
  }

  const [match] = search(name, manufacturers, {
    keySelector: (item) => [item.name, ...(item.aliases ?? [])],
    threshold,
    returnMatchData: true,
    ignoreCase: true,
    ignoreSymbols: true,
    normalizeWhitespace: true,
  });

  if (!match) return null;

  return {
    manufacturer: match.item,
    score: Number(match.score.toFixed(3)),
  };
}

export function fuzzySearch(query, items, options = {}) {
  if (!query || !Array.isArray(items) || items.length === 0) return [];

  const {
    keySelector = (item) => String(item),
    threshold = 0.5,
    limit = 10,
  } = options;

  return search(query, items, {
    keySelector,
    threshold,
    returnMatchData: true,
    ignoreCase: true,
    ignoreSymbols: true,
    normalizeWhitespace: true,
  })
    .slice(0, limit)
    .map((match) => ({
      item: match.item,
      score: Number(match.score.toFixed(3)),
    }));
}
