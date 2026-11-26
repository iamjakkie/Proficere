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
 * Every chapter the open page has reached gets credit. A chapter whose last
 * page is behind the open page is complete. The chapter that contains the
 * page gets a partial percent. Saved progress is never lowered. Books with
 * no PDF page spans use the furthest page opened in the file.
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
  const nextBookPage = Math.max(bookReadPage, page);
  if (!hasPdfSpans(chapters)) {
    return { bookReadPage: nextBookPage, credits: [] };
  }
  const credits: ReadingCredit[] = [];
  chapters.forEach((chapter, index) => {
    const span = chapterPdfSpan(chapters, index, pageCount);
    if (!span || page < span.start) return;
    const counted = Math.min(span.end, Math.max(creditedPdfPage(chapter.pagePosition) ?? 0, page));
    const length = span.end - span.start + 1;
    const progressPercent = Math.min(100, Math.round(((counted - span.start + 1) / length) * 100));
    if (progressPercent <= chapter.progressPercent) return;
    credits.push({ id: chapter.id, progressPercent, creditedPdfPage: counted });
  });
  return { bookReadPage: nextBookPage, credits };
}

const FRONT_MATTER =
  /^(?:table of contents|contents|preface|foreword|prologue|acknowledg(?:e)?ments?|dedication|copyright|bibliography|references|glossary|index|list of (?:figures|tables|illustrations|abbreviations|symbols|acronyms)|about the authors?|notation|abbreviations|title page|half[- ]title|frontispiece|colophon|errata|series page)\b/i;

/** Preface, contents, acknowledgements, and the title page do not get a review or an exam. */
export function isFrontMatter(title: string): boolean {
  const name = title.replace(/\s+/g, " ").trim();
  if (/^(?:chapter\s+\d+|\d+(?:\.\d+)+)\b/i.test(name)) return false;
  if (FRONT_MATTER.test(name)) return true;
  return !/^chapter\b/i.test(name) && !/^\d/.test(name) && name.length > 48;
}

export function usesNumberedChapters(titles: string[]): boolean {
  return titles.some((title) => /^chapter\s+\d+\b/i.test(title.trim()));
}

/** A numbered book stops at each “Chapter N”. Other books stop at each real heading. */
export function isMilestoneTitle(title: string, numberedChapters: boolean): boolean {
  if (isFrontMatter(title)) return false;
  const name = title.trim();
  if (numberedChapters) return /^chapter\s+\d+\b/i.test(name);
  return !/^\d+(?:\.\d+)+\b/.test(name);
}

/** One exam covers several chapters. A single heading is not a stop. */
const EXAM_GROUP_SIZE = 4;

/** A one-page heading that the next section also starts on is the title of a part. */
export function isPartOpener(chapters: MilestoneChapter[], index: number): boolean {
  const chapter = chapters[index];
  const next = chapters[index + 1];
  if (!chapter || !next || isFrontMatter(chapter.title) || isFrontMatter(next.title)) return false;
  if (chapter.pdfPageStart == null || chapter.pdfPageEnd == null || next.pdfPageStart == null) return false;
  return chapter.pdfPageEnd === chapter.pdfPageStart && next.pdfPageStart === chapter.pdfPageStart;
}

/**
 * A numbered book stops at each “Chapter N”. The outline and the questions that
 * share the title page are part of that chapter. Other books stop at part titles,
 * or at every fourth real heading when the book has no part titles.
 */
export function examGroupStarts(chapters: MilestoneChapter[]): number[] {
  const numbered = usesNumberedChapters(chapters.map((chapter) => chapter.title));
  if (numbered) {
    return chapters.flatMap((chapter, index) => (isMilestoneTitle(chapter.title, true) ? [index] : []));
  }
  const openers = chapters.flatMap((_, index) => (isPartOpener(chapters, index) ? [index] : []));
  if (openers.length >= 2) return openers;
  const content = chapters.flatMap((chapter, index) => (isMilestoneTitle(chapter.title, false) ? [index] : []));
  const starts: number[] = [];
  for (let index = 0; index < content.length; index += EXAM_GROUP_SIZE) {
    const start = content[index];
    if (start != null) starts.push(start);
  }
  return starts;
}

export type MilestoneChapter = ReadingChapter & { title: string };

export type ReadingMilestoneGate = {
  chapterId: string;
  title: string;
  stopIndex: number;
  resumePage: number;
};

/**
 * Entering the next chapter requires an exam for the chapter just finished.
 * Sections inside the open chapter, including its outline, do not stop the reader.
 */
export function readingMilestoneGate(
  chapters: MilestoneChapter[],
  page: number,
  pageCount: number,
): ReadingMilestoneGate | null {
  if (!Number.isInteger(page) || page < 1) return null;
  const milestones = examGroupStarts(chapters);
  if (milestones.length < 2) return null;
  let entered = -1;
  for (const index of milestones) {
    const span = chapterPdfSpan(chapters, index, pageCount);
    if (span && page >= span.start) entered = index;
  }
  const enteredPos = milestones.indexOf(entered);
  if (enteredPos <= 0) return null;
  const previousIndex = milestones[enteredPos - 1] ?? -1;
  const previous = chapters[previousIndex];
  const previousSpan = chapterPdfSpan(chapters, previousIndex, pageCount);
  const enteredSpan = chapterPdfSpan(chapters, entered, pageCount);
  if (!previous || !previousSpan || !enteredSpan || page <= previousSpan.end) return null;
  return {
    chapterId: previous.id,
    title: previous.title,
    stopIndex: entered,
    resumePage: Math.max(1, enteredSpan.start - 1),
  };
}

/** Every chapter in the milestone that contains this heading, from its start through the next milestone. */
export function milestoneSpanIds(chapters: MilestoneChapter[], chapterId: string): string[] {
  const starts = examGroupStarts(chapters);
  const index = chapters.findIndex((chapter) => chapter.id === chapterId);
  if (index < 0 || starts.length === 0) return [];
  let startPos = -1;
  for (let position = 0; position < starts.length; position += 1) {
    if (starts[position]! <= index) startPos = position;
  }
  if (startPos < 0) return [];
  const start = starts[startPos]!;
  const end = starts[startPos + 1] ?? chapters.length;
  const ids: string[] = [];
  for (let cursor = start; cursor < end; cursor += 1) {
    if (isFrontMatter(chapters[cursor]?.title ?? "")) continue;
    const id = chapters[cursor]?.id;
    if (id) ids.push(id);
  }
  return ids;
}

/** Chapters in the finished part, spread across it when the part is long. */
export function milestoneChapterIds(chapters: MilestoneChapter[], milestoneId: string): string[] {
  const starts = examGroupStarts(chapters);
  const start = chapters.findIndex((chapter) => chapter.id === milestoneId);
  if (start < 0) return [];
  const position = starts.indexOf(start);
  const end = position >= 0 && starts[position + 1] != null ? starts[position + 1]! : chapters.length;
  const ids: string[] = [];
  for (let index = start; index < end; index += 1) {
    if (isFrontMatter(chapters[index]?.title ?? "")) continue;
    const id = chapters[index]?.id;
    if (id) ids.push(id);
  }
  return spreadChapterIds(ids, 6);
}

function spreadChapterIds(ids: string[], limit: number): string[] {
  if (ids.length <= limit) return ids;
  const picked: string[] = [];
  for (let slot = 0; slot < limit; slot += 1) {
    const index = Math.round((slot * (ids.length - 1)) / (limit - 1));
    const id = ids[index];
    if (id && !picked.includes(id)) picked.push(id);
  }
  return picked;
}

export function resumePdfPage(chapter: ReadingChapter): number | null {
  const credited = creditedPdfPage(chapter.pagePosition);
  if (chapter.pdfPageStart == null) return credited;
  if (credited == null || credited < chapter.pdfPageStart) return chapter.pdfPageStart;
  if (chapter.pdfPageEnd != null && credited > chapter.pdfPageEnd) return chapter.pdfPageStart;
  return credited;
}

export type ShelfSpanChapter = {
  id: string;
  selected?: boolean;
  progressPercent: number;
  pagePosition?: string | null;
  pageStart?: string | null;
  pageEnd?: string | null;
  pdfPageStart?: number | null;
  pdfPageEnd?: number | null;
};

export type ShelfPagePlan = {
  /** Printed page numbers from the paper book, or PDF pages when those are all the outline has. */
  scale: "printed" | "pdf";
  /** Furthest page already logged, or 0 when none is. */
  reached: number;
  /** Page this sitting lands on. */
  through: number;
  updates: { id: string; progressPercent: number }[];
};

function wholePage(value: unknown): number | null {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : null;
}

function printedSpan(chapters: ShelfSpanChapter[], index: number): { start: number; end: number } | null {
  const start = wholePage(chapters[index]?.pageStart);
  if (start == null) return null;
  let end = wholePage(chapters[index]?.pageEnd);
  if (end == null || end < start) {
    const next = chapters
      .slice(index + 1)
      .map((chapter) => wholePage(chapter.pageStart))
      .find((page) => page != null && page > start);
    end = next != null ? next - 1 : start;
  }
  return { start, end };
}

function pageReached(
  chapter: ShelfSpanChapter,
  span: { start: number; end: number },
  scale: "printed" | "pdf",
): number | null {
  if (chapter.progressPercent >= 100) return span.end;
  if (scale === "pdf") {
    const credited = creditedPdfPage(chapter.pagePosition);
    if (credited != null && credited >= span.start) return Math.min(span.end, credited);
  }
  if (chapter.progressPercent <= 0) return null;
  const length = span.end - span.start + 1;
  const done = Math.round((chapter.progressPercent / 100) * length);
  return Math.min(span.end, span.start + Math.max(done, 0) - 1);
}

export type ShelfPageStore = { pdf?: number | null; printed?: number | null };

function shelfSpans(
  chapters: ShelfSpanChapter[],
  stored?: ShelfPageStore | null,
): {
  scale: "printed" | "pdf";
  reached: number;
  spans: Map<number, { start: number; end: number }>;
} | null {
  if (!chapters.length) return null;
  const indexes = chapters
    .map((chapter, index) => ({ chapter, index }))
    .filter(({ chapter }, _, all) => (all.some((item) => item.chapter.selected) ? chapter.selected !== false : true))
    .map(({ index }) => index);
  const printed = indexes.some((index) => wholePage(chapters[index]?.pageStart) != null);
  const scale: "printed" | "pdf" = printed ? "printed" : "pdf";
  const reading: ReadingChapter[] = chapters.map((chapter, index) => ({
    id: chapter.id || String(index),
    pdfPageStart: chapter.pdfPageStart ?? null,
    pdfPageEnd: chapter.pdfPageEnd ?? null,
    progressPercent: chapter.progressPercent,
    pagePosition: chapter.pagePosition,
  }));
  const spans = new Map<number, { start: number; end: number }>();
  for (const index of indexes) {
    const span = scale === "printed" ? printedSpan(chapters, index) : chapterPdfSpan(reading, index, 0);
    if (span) spans.set(index, span);
  }
  if (spans.size === 0) return null;
  const storedPage = scale === "pdf" ? wholePage(stored?.pdf) : wholePage(stored?.printed);
  let reached = storedPage ?? 0;
  for (const [index, span] of spans) {
    const chapter = chapters[index];
    if (!chapter) continue;
    const value = pageReached(chapter, span, scale);
    if (value != null) reached = Math.max(reached, value);
  }
  return { scale, reached, spans };
}

/** Furthest page already logged. Null when the book has no page numbers. */
export function shelfPageNow(
  chapters: ShelfSpanChapter[],
  stored?: ShelfPageStore | null,
): { scale: "printed" | "pdf"; reached: number } | null {
  const located = shelfSpans(chapters, stored);
  if (!located) return null;
  return { scale: located.scale, reached: located.reached };
}

/**
 * Chapters that move when the paper copy is finished on `page`. A chapter left
 * out of the plan does not move. Returns null when the book has no page numbers.
 */
export function shelfReadingPlan(
  chapters: ShelfSpanChapter[],
  page: number,
  stored?: ShelfPageStore | null,
): ShelfPagePlan | null {
  if (!Number.isInteger(page) || page < 1) return null;
  const located = shelfSpans(chapters, stored);
  if (!located) return null;
  const updates: { id: string; progressPercent: number }[] = [];
  for (const [index, span] of located.spans) {
    const chapter = chapters[index];
    if (!chapter || page < span.start) continue;
    const length = span.end - span.start + 1;
    const progressPercent =
      page >= span.end ? 100 : Math.max(1, Math.min(99, Math.round(((page - span.start + 1) / length) * 100)));
    if (progressPercent > chapter.progressPercent) updates.push({ id: chapter.id, progressPercent });
  }
  return { scale: located.scale, reached: located.reached, through: page, updates };
}
