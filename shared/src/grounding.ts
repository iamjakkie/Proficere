/** Normalize for quote matching without inventing content. */
export function normalizeForMatch(text: string): string {
  return text
    .replace(/\u00ad/g, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function passageExistsInSource(passage: string, source: string): boolean {
  if (!passage.trim()) return false;
  const haystack = normalizeForMatch(source);
  const needle = normalizeForMatch(passage);
  if (needle.length < 12) return false;
  return haystack.includes(needle);
}

export function findSpan(passage: string, source: string): {
  start: number;
  end: number;
} | null {
  const idx = normalizeForMatch(source).indexOf(normalizeForMatch(passage));
  if (idx < 0) return null;
  // Approximate original offsets by scanning; sufficient for locators.
  return { start: idx, end: idx + passage.length };
}

export function titleGroundedInSource(title: string, source: string): boolean {
  const t = normalizeForMatch(title);
  if (t.length < 3) return false;
  return normalizeForMatch(source).includes(t);
}
