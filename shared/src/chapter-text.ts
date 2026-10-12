const MIN_BODY_CHARS = 180;

/** A title or contents line is not enough to ground a review. */
export function isSubstantialChapter(text: string, title?: string): boolean {
  let body = text.replace(/--- PDF page \d+ ---/g, " ");
  const heading = title?.trim();
  if (heading) {
    body = body.replace(new RegExp(escapeRegExp(heading), "i"), " ");
  }
  return body.replace(/\s+/g, " ").trim().length >= MIN_BODY_CHARS;
}

/** A heading list has length, but it has no sentence the model can quote. */
export function hasProse(text: string): boolean {
  const body = text.replace(/--- PDF page \d+ ---/g, " ");
  const sentences = body.match(/[^.!?\n]{15,}[.!?]/g) ?? [];
  if (sentences.some((sentence) => sentence.trim().split(/\s+/).length >= 8)) return true;
  return body.split("\n").some((line) => line.trim().length >= 160);
}

export function sliceLongestChapter(
  text: string,
  title: string,
  nextTitles: string[],
): { excerpt: string; pdfPageStart: number | null; pdfPageEnd: number | null } | null {
  const needle = title.trim();
  if (needle.length < 3) return null;
  const candidates = indexesOf(text, needle).map((index) => {
    const after = text.slice(index);
    let end = after.length;
    const lowerAfter = after.toLowerCase();
    for (const next of nextTitles) {
      const nextNeedle = next.trim();
      if (nextNeedle.length < 3 || nextNeedle.toLowerCase() === needle.toLowerCase()) continue;
      const found = lowerAfter.indexOf(nextNeedle.toLowerCase(), needle.length);
      if (found > needle.length && found < end) end = found;
    }
    const excerpt = after.slice(0, end).trim();
    return { excerpt, index };
  });
  const substantial = candidates.filter((item) => isSubstantialChapter(item.excerpt, title));
  const pool = substantial.filter((item) => !looksLikeContentsLine(item.excerpt));
  const chosen = longest(pool.length ? pool : substantial);
  if (!chosen) return null;
  const inside = pdfPageBounds(chosen.excerpt);
  return {
    excerpt: chosen.excerpt,
    pdfPageStart: pageMarkerBefore(text, chosen.index) ?? inside.pdfPageStart,
    pdfPageEnd: inside.pdfPageEnd ?? pageMarkerBefore(text, chosen.index),
  };
}

function pageMarkerBefore(text: string, index: number): number | null {
  const marks = [...text.slice(0, index).matchAll(/--- PDF page (\d+) ---/g)];
  const last = marks[marks.length - 1];
  return last ? Number(last[1]) : null;
}

export function capMarkedPages(text: string, maxPages: number): string {
  if (maxPages < 1) return text;
  const marks = [...text.matchAll(/--- PDF page \d+ ---/g)];
  if (marks.length <= maxPages) return text;
  const cut = marks[maxPages]?.index ?? text.length;
  return text.slice(0, cut).trim();
}

export function pdfPageBounds(excerpt: string): {
  pdfPageStart: number | null;
  pdfPageEnd: number | null;
} {
  const pages = [...excerpt.matchAll(/--- PDF page (\d+) ---/g)].map((match) => Number(match[1]));
  if (!pages.length) return { pdfPageStart: null, pdfPageEnd: null };
  return { pdfPageStart: pages[0] ?? null, pdfPageEnd: pages[pages.length - 1] ?? null };
}

function looksLikeContentsLine(excerpt: string): boolean {
  const firstLine = excerpt.split(/\n/, 1)[0] ?? excerpt;
  return /[.….]{3,}/.test(firstLine) || /\s\d{1,4}\s*$/.test(firstLine.trim());
}

function longest(excerpts: { excerpt: string; index: number }[]): { excerpt: string; index: number } | null {
  let best: { excerpt: string; index: number } | null = null;
  for (const excerpt of excerpts) {
    if (!best || excerpt.excerpt.length > best.excerpt.length) best = excerpt;
  }
  return best;
}

function indexesOf(text: string, needle: string): number[] {
  const indexes: number[] = [];
  const haystack = text.toLowerCase();
  const target = needle.toLowerCase();
  let from = 0;
  while (from < haystack.length) {
    const found = haystack.indexOf(target, from);
    if (found < 0) break;
    indexes.push(found);
    from = found + target.length;
  }
  return indexes;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
