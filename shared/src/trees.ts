/**
 * One tree per book. Reading adds layers to the crown; the trunk stays one
 * block. Progress is weighted by page span when the chapter has numeric page
 * bounds. A later grouping sets `identifiers.treeGroup`; that string is the
 * tree type. Unknown groups keep the default type until a style is added.
 */
export const DEFAULT_TREE_TYPE = "broadleaf";
export const TREE_TRUNK_MIN = 1;
export const TREE_TRUNK_MAX = 8;

export function treeTypeForBook(identifiers: Record<string, string> | undefined): string {
  const group = identifiers?.treeGroup?.trim();
  return group || DEFAULT_TREE_TYPE;
}

export function readingFraction(identifiers: Record<string, string> | undefined): number | null {
  const page = Number(identifiers?.readPdfPage);
  const count = Number(identifiers?.pdfPageCount);
  if (!Number.isInteger(page) || !Number.isInteger(count) || page <= 0 || count <= 0) return null;
  return Math.min(1, page / count);
}

export function bookGrowth(
  chapters: {
    progressPercent: number;
    pageStart?: string | null;
    pageEnd?: string | null;
  }[],
  readingFraction?: number | null,
): number {
  let fromChapters = 0;
  if (chapters.length) {
    let weighted = 0;
    let weight = 0;
    for (const chapter of chapters) {
      const span = pageSpan(chapter.pageStart, chapter.pageEnd);
      const progress = Math.min(100, Math.max(0, chapter.progressPercent)) / 100;
      weighted += span * progress;
      weight += span;
    }
    fromChapters = weight === 0 ? 0 : weighted / weight;
  }
  const fromReading =
    readingFraction == null || !Number.isFinite(readingFraction)
      ? 0
      : Math.min(1, Math.max(0, readingFraction));
  if (!chapters.length) return fromReading;
  if (readingFraction == null) return fromChapters;
  return Math.max(fromChapters, fromReading);
}

/** Chapter spans drive the tree once any chapter knows its PDF pages. Otherwise the furthest opened page does. */
export function growthForBook(
  chapters: {
    progressPercent: number;
    pageStart?: string | null;
    pageEnd?: string | null;
    pdfPageStart?: number | null;
  }[],
  identifiers: Record<string, string> | undefined,
): number {
  const located = chapters.some((chapter) => chapter.pdfPageStart != null);
  return bookGrowth(chapters, located ? null : readingFraction(identifiers));
}

/** Crown layers: 1 for an unread book, 8 when it is finished. */
export function trunkBlocks(growth: number): number {
  const clamped = Math.min(1, Math.max(0, growth));
  return TREE_TRUNK_MIN + Math.round(clamped * (TREE_TRUNK_MAX - TREE_TRUNK_MIN));
}

function pageSpan(pageStart?: string | null, pageEnd?: string | null): number {
  if (pageStart == null || pageEnd == null || pageStart === "" || pageEnd === "") return 1;
  const start = Number(pageStart);
  const end = Number(pageEnd);
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) return end - start;
  return 1;
}
