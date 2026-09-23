import type { OutlineChapter } from "./schemas.js";
import { titleGroundedInSource } from "./grounding.js";

const HEADING =
  /^(?:chapter\s+)?(\d+(?:\.\d+)*)[.:)\s]+(.+?)(?:\s+[.…]+\s*(\d+[a-zA-Z-]*)\s*)?$/i;
const FRONT_MATTER_PAGES = 30;

export function parseOutlineFromText(text: string): OutlineChapter[] {
  const chapters: OutlineChapter[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    const match = raw.match(HEADING);
    if (!match) continue;
    const title = match[2].replace(/\s+/g, " ").trim();
    if (!titleGroundedInSource(title, text)) continue;
    const start = text.indexOf(raw);
    chapters.push({
      number: match[1],
      title,
      pageStart: match[3] ?? null,
      pageEnd: null,
      sourceSpanStart: start >= 0 ? start : null,
      sourceSpanEnd: null,
    });
  }
  fillSourceSpans(chapters, text);
  return chapters;
}

/** Contents-page lines: title plus the printed page printed beside it. */
export function parseTableOfContents(text: string): OutlineChapter[] {
  const chapters: OutlineChapter[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    let raw = lines[i].trim();
    if (!raw) continue;
    let pageStart: string | null = null;
    let pageEnd: string | null = null;
    const continued = i + 1 < lines.length ? lines[i + 1].trim() : "";
    const wrap = continued.match(/^[.·…•\s]{2,}(\d{1,4}|[ivxlcdm]{1,8})(?:\s*[-–—]\s*(\d{1,4}))?\s*$/i);
    if (wrap && !trailingPage(raw)) {
      pageStart = wrap[1];
      pageEnd = wrap[2] ?? null;
      i += 1;
    } else {
      const split = splitPrintedPage(raw);
      raw = split.rest;
      pageStart = split.pageStart;
      pageEnd = split.pageEnd;
    }
    if (!pageStart) continue;
    const parsed = numberedTitle(raw);
    const title = (parsed?.title ?? raw).replace(/\s+/g, " ").trim();
    if (!keepTocTitle(title) || !titleGroundedInSource(title, text)) continue;
    const prev = chapters[chapters.length - 1];
    if (prev && normalizeTitle(prev.title) === normalizeTitle(title) && prev.pageStart === pageStart) {
      continue;
    }
    chapters.push({
      number: parsed?.number ?? null,
      title,
      pageStart,
      pageEnd,
      sourceSpanStart: text.indexOf(title),
      sourceSpanEnd: null,
    });
  }
  fillSourceSpans(chapters, text);
  return fillPrintedRanges(chapters).slice(0, 250);
}

export const TOC_SCAN_PAGES = FRONT_MATTER_PAGES;

function trailingPage(raw: string): boolean {
  return splitPrintedPage(raw).pageStart != null;
}

function splitPrintedPage(raw: string): {
  rest: string;
  pageStart: string | null;
  pageEnd: string | null;
} {
  const range = raw.match(/^(.*?)\s+(\d{1,4})\s*[-–—]\s*(\d{1,4})\s*$/);
  if (range && numberedTitle(range[1].trim())) {
    return { rest: range[1].trim(), pageStart: range[2], pageEnd: range[3] };
  }
  const leaders = raw.match(
    /^(.*?)\s*[.·…•](?:[.·…•]|\s){1,}\s*(\d{1,4}|[ivxlcdm]{1,8})(?:\s*[-–—]\s*(\d{1,4}))?\s*$/i,
  );
  if (leaders) {
    return { rest: leaders[1].trim(), pageStart: leaders[2], pageEnd: leaders[3] ?? null };
  }
  const numbered = raw.match(
    /^(?:(?:chapter|part|appendix|section)\s+)?(\d+(?:\.\d+)*)[.:)\s]\s*(.+?)\s+(\d{1,4})\s*$/i,
  );
  if (numbered) {
    return {
      rest: raw.replace(/\s+\d{1,4}\s*$/, "").trim(),
      pageStart: numbered[3],
      pageEnd: null,
    };
  }
  return { rest: raw, pageStart: null, pageEnd: null };
}

function numberedTitle(raw: string): { number: string; title: string } | null {
  const match = raw
    .trim()
    .match(/^(?:(?:chapter|part|appendix|section)\s+)?(\d+(?:\.\d+)*|[IVXLCDM]{1,8})(?:[.:)\]]+|\s+)(.+)$/i);
  if (!match) return null;
  const title = match[2].replace(/\s+/g, " ").trim();
  if (!title) return null;
  return { number: match[1], title };
}

function keepTocTitle(title: string): boolean {
  if (title.length < 3 || title.length > 120) return false;
  if (/^\d+$/.test(title)) return false;
  if (/^(contents|table of contents|index|copyright)$/i.test(title)) return false;
  return true;
}

function fillSourceSpans(chapters: OutlineChapter[], text: string): void {
  for (let i = 0; i < chapters.length; i++) {
    const start = chapters[i].sourceSpanStart ?? 0;
    const end = i + 1 < chapters.length ? chapters[i + 1].sourceSpanStart ?? text.length : text.length;
    chapters[i].sourceSpanEnd = end;
    void start;
  }
}

function fillPrintedRanges(chapters: OutlineChapter[]): OutlineChapter[] {
  return chapters.map((chapter, index) => {
    if (chapter.pageEnd) return chapter;
    const current = Number(chapter.pageStart);
    const next = Number(chapters[index + 1]?.pageStart);
    if (!Number.isInteger(current) || !Number.isInteger(next) || next <= current) return chapter;
    return { ...chapter, pageEnd: String(next - 1) };
  });
}

/** Copy printed TOC pages onto bookmark (or other) titles without inventing names. */
export function overlayPrintedPages(
  outline: OutlineChapter[],
  toc: OutlineChapter[],
): OutlineChapter[] {
  if (!outline.length) return fillPrintedRanges(toc);
  if (!toc.length) return fillPrintedRanges(outline);
  const unused = [...toc];
  const merged = outline.map((chapter) => {
    const matchIndex = unused.findIndex((row) => sameTocEntry(chapter, row));
    if (matchIndex < 0) return chapter;
    const match = unused.splice(matchIndex, 1)[0];
    return {
      ...chapter,
      number: chapter.number ?? match.number,
      pageStart: match.pageStart ?? chapter.pageStart,
      pageEnd: match.pageEnd ?? chapter.pageEnd,
    };
  });
  return fillPrintedRanges(inferPdfPagesFromPrinted(merged));
}

function sameTocEntry(left: OutlineChapter, right: OutlineChapter): boolean {
  if (looseTitle(left.title) === looseTitle(right.title)) return true;
  if (left.number && right.number && left.number === right.number) {
    return looseTitle(left.title).includes(looseTitle(right.title)) ||
      looseTitle(right.title).includes(looseTitle(left.title));
  }
  return false;
}

function looseTitle(title: string): string {
  return normalizeTitle(title)
    .replace(/^(chapter|part|appendix|section)\s+/, "")
    .replace(/[^a-z0-9]+/g, "");
}

function inferPdfPagesFromPrinted(outline: OutlineChapter[]): OutlineChapter[] {
  const offsets: number[] = [];
  for (const chapter of outline) {
    const printed = Number(chapter.pageStart);
    if (chapter.pdfPageStart != null && Number.isInteger(printed) && printed > 0) {
      offsets.push(chapter.pdfPageStart - printed);
    }
  }
  const offset = commonOffset(offsets);
  if (offset == null) return outline;
  return outline.map((chapter) => {
    const printed = Number(chapter.pageStart);
    const printedEnd = Number(chapter.pageEnd);
    if (!Number.isInteger(printed) || printed <= 0) return chapter;
    return {
      ...chapter,
      pdfPageStart: chapter.pdfPageStart ?? printed + offset,
      pdfPageEnd:
        chapter.pdfPageEnd ??
        (Number.isInteger(printedEnd) && printedEnd >= printed ? printedEnd + offset : null),
    };
  });
}

function commonOffset(offsets: number[]): number | null {
  if (offsets.length < 2) return null;
  const counts = new Map<number, number>();
  for (const offset of offsets) counts.set(offset, (counts.get(offset) ?? 0) + 1);
  let best: { offset: number; count: number } | null = null;
  for (const [offset, count] of counts) {
    if (!best || count > best.count) best = { offset, count };
  }
  return best && best.count >= 2 ? best.offset : null;
}

const PDF_PAGE = /--- PDF page (\d+) ---/g;

/** Record PDF page indices from extraction markers. Printed labels stay on pageStart. */
export function assignPdfPageIndices(
  text: string,
  chapters: OutlineChapter[],
): OutlineChapter[] {
  const marks: { page: number; index: number }[] = [];
  PDF_PAGE.lastIndex = 0;
  for (const match of text.matchAll(PDF_PAGE)) {
    if (match.index == null) continue;
    marks.push({ page: Number(match[1]), index: match.index });
  }
  if (marks.length === 0) return chapters;
  return chapters.map((chapter) => {
    const start = chapter.sourceSpanStart ?? 0;
    const end = chapter.sourceSpanEnd ?? text.length;
    const startMark = [...marks].reverse().find((mark) => mark.index <= start);
    const endMark = [...marks].reverse().find((mark) => mark.index < Math.max(end, start + 1));
    return {
      ...chapter,
      pdfPageStart: startMark?.page ?? chapter.pdfPageStart ?? null,
      pdfPageEnd: endMark?.page ?? startMark?.page ?? chapter.pdfPageEnd ?? null,
    };
  });
}

/** Copy evidenced spans and page labels from a local parse. Never invents titles. */
export function enrichOutline(outline: OutlineChapter[], source: string): OutlineChapter[] {
  const local = parseOutlineFromText(source);
  const byTitle = new Map(local.map((chapter) => [normalizeTitle(chapter.title), chapter]));
  const merged = outline.map((chapter) => {
    const match = byTitle.get(normalizeTitle(chapter.title));
    if (!match) {
      const { existingId: _ignored, ...rest } = chapter;
      void _ignored;
      return rest;
    }
    return {
      ...chapter,
      existingId: undefined,
      pageStart: chapter.pageStart ?? match.pageStart ?? null,
      pageEnd: chapter.pageEnd ?? match.pageEnd ?? null,
      sourceSpanStart: chapter.sourceSpanStart ?? match.sourceSpanStart ?? null,
      sourceSpanEnd: chapter.sourceSpanEnd ?? match.sourceSpanEnd ?? null,
    };
  });
  return assignPdfPageIndices(source, merged);
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

export type PdfBookmark = {
  title?: string | null;
  dest?: unknown;
  url?: string | null;
  items?: PdfBookmark[];
};

/** Flatten a PDF bookmark tree. Pages come from dest resolution, never invented titles. */
export function outlineFromPdfBookmarks(
  nodes: PdfBookmark[],
  pageOf: (node: PdfBookmark) => number | null,
): OutlineChapter[] {
  const chapters: OutlineChapter[] = [];
  walkBookmarks(nodes, pageOf, chapters, null);
  for (let i = 0; i < chapters.length; i++) {
    const start = chapters[i].pdfPageStart;
    const next = chapters[i + 1]?.pdfPageStart;
    if (start != null && next != null && next >= start) {
      chapters[i].pdfPageEnd = next > start ? next - 1 : start;
    } else if (start != null && chapters[i].pdfPageEnd == null) {
      chapters[i].pdfPageEnd = start;
    }
  }
  return chapters.slice(0, 250);
}

function walkBookmarks(
  nodes: PdfBookmark[],
  pageOf: (node: PdfBookmark) => number | null,
  chapters: OutlineChapter[],
  parentNumber: string | null,
): void {
  let index = 0;
  for (const node of nodes) {
    const title = String(node.title ?? "").replace(/\s+/g, " ").trim();
    if (!title || node.url) {
      if (node.items?.length) walkBookmarks(node.items, pageOf, chapters, parentNumber);
      continue;
    }
    index += 1;
    const number = parentNumber ? `${parentNumber}.${index}` : String(index);
    const page = pageOf(node);
    const prev = chapters[chapters.length - 1];
    if (
      prev &&
      normalizeTitle(prev.title) === normalizeTitle(title) &&
      (prev.pdfPageStart ?? null) === page
    ) {
      if (node.items?.length) walkBookmarks(node.items, pageOf, chapters, number);
      continue;
    }
    chapters.push({
      number,
      title,
      parentNumber,
      pageStart: null,
      pageEnd: null,
      pdfPageStart: page,
      pdfPageEnd: null,
    });
    if (node.items?.length) walkBookmarks(node.items, pageOf, chapters, number);
  }
}

export function excerptForChapter(
  text: string,
  chapter: Pick<OutlineChapter, "sourceSpanStart" | "sourceSpanEnd" | "title">,
): string {
  if (
    chapter.sourceSpanStart != null &&
    chapter.sourceSpanEnd != null &&
    chapter.sourceSpanEnd > chapter.sourceSpanStart
  ) {
    return text.slice(chapter.sourceSpanStart, chapter.sourceSpanEnd).trim();
  }
  return text;
}
