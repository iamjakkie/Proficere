/** Furthest PDF page already credited to a chapter, stored in pagePosition. */
export const PDF_POSITION_PREFIX = "pdf:";

export type ReadingChapter = {
  id: string;
  pdfPageStart: number | null;
  pdfPageEnd: number | null;
  progressPercent: number;
  pagePosition?: string | null;
};

export type ReadingCredit = {
  id: string;
  progressPercent: number;
  creditedPdfPage: number;
};

export function creditedPdfPage(pagePosition: string | null | undefined): number | null {
  if (!pagePosition?.startsWith(PDF_POSITION_PREFIX)) return null;
  const value = Number(pagePosition.slice(PDF_POSITION_PREFIX.length));
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function hasPdfSpans(chapters: Pick<ReadingChapter, "pdfPageStart">[]): boolean {
  return chapters.some((chapter) => chapter.pdfPageStart != null);
}

/** Inclusive PDF page span. A missing end runs up to the next chapter, or the last file page. */
export function chapterPdfSpan(
  chapters: ReadingChapter[],
  index: number,
  pageCount: number,
): { start: number; end: number } | null {
  const chapter = chapters[index];
  if (!chapter || chapter.pdfPageStart == null || chapter.pdfPageStart < 1) return null;
  const start = chapter.pdfPageStart;
  let end = chapter.pdfPageEnd;
  if (end == null || end < start) {
    const next = chapters
      .slice(index + 1)
      .find((item) => item.pdfPageStart != null && item.pdfPageStart > start);
    end = next?.pdfPageStart != null ? next.pdfPageStart - 1 : pageCount;
  }
  if (end < start || end < 1) return null;
  return { start, end };
}

/**
 * The page on screen is progress for the chapter that contains it.
 * Earlier chapters stay as they are. A page past the previous mark in that
 * chapter counts, including a jump to its end. Books with no PDF page spans
 * use the furthest page opened in the file.
 */
export function creditVisitedPage(
  chapters: ReadingChapter[],
  page: number,
  pageCount: number,
  bookReadPage: number,
): { bookReadPage: number; credits: ReadingCredit[] } {
  if (!Number.isInteger(page) || !Number.isInteger(pageCount) || page < 1 || pageCount < 1 || page > pageCount) {
    return { bookReadPage, credits: [] };
  }
  if (!hasPdfSpans(chapters)) {
    return { bookReadPage: Math.max(bookReadPage, page), credits: [] };
  }
  let match = -1;
  chapters.forEach((_, index) => {
    const span = chapterPdfSpan(chapters, index, pageCount);
    if (span && page >= span.start && page <= span.end) match = index;
  });
  if (match < 0) return { bookReadPage, credits: [] };
  const chapter = chapters[match];
  const span = chapterPdfSpan(chapters, match, pageCount);
  if (!chapter || !span) return { bookReadPage, credits: [] };
  const reached = Math.min(span.end, Math.max(creditedPdfPage(chapter.pagePosition) ?? 0, page));
  const length = span.end - span.start + 1;
  const progressPercent = Math.round(((reached - span.start + 1) / length) * 100);
  if (progressPercent <= chapter.progressPercent) return { bookReadPage, credits: [] };
  return {
    bookReadPage,
    credits: [{ id: chapter.id, progressPercent, creditedPdfPage: reached }],
  };
}

export function resumePdfPage(chapter: ReadingChapter): number | null {
  const credited = creditedPdfPage(chapter.pagePosition);
  if (chapter.pdfPageStart == null) return credited;
  if (credited == null || credited < chapter.pdfPageStart) return chapter.pdfPageStart;
  if (chapter.pdfPageEnd != null && credited > chapter.pdfPageEnd) return chapter.pdfPageStart;
  return credited;
}
