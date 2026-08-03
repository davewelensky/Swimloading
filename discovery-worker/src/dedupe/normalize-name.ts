// Generic descriptors stripped before comparing two event names — kept
// deliberately short. Distinctive category words like "swim", "open",
// "water" are NOT stripped: removing them would make unrelated swim
// events look more similar than they are, which is the opposite of what
// a duplicate check should do.
const STOPWORDS = new Set(['the', 'a', 'an', 'official', 'annual', 'race', 'day', 'event', 'festival']);

export function normalizeName(name: string | null): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0 && !STOPWORDS.has(token))
    .join(' ');
}

export function nameTokens(name: string | null): Set<string> {
  const normalized = normalizeName(name);
  return new Set(normalized.length > 0 ? normalized.split(' ') : []);
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersectionSize = 0;
  for (const token of a) if (b.has(token)) intersectionSize++;
  const unionSize = a.size + b.size - intersectionSize;
  return unionSize === 0 ? 0 : intersectionSize / unionSize;
}
