import {
  AppError,
  TOC_SCAN_PAGES,
  assignPdfPageIndices,
  capMarkedPages,
  outlineFromPdfBookmarks,
  overlayPrintedPages,
  parseOutlineFromText,
  parseTableOfContents,
  pdfPageBounds,
  sliceLongestChapter,
  type OutlineChapter,
  type PdfBookmark,
} from "@progress-island/shared";

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PAGES = 40;
const LIBRARY_MAX_BYTES = 150 * 1024 * 1024;
const LIBRARY_MAX_SCAN_PAGES = 800;
const LIBRARY_MAX_CHAPTER_PAGES = 40;

type PdfDoc = {
  numPages: number;
  getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: unknown[] }> }>;
  getOutline?: () => Promise<PdfBookmark[] | null>;
  getDestination?: (id: string) => Promise<unknown>;
  getPageIndex?: (ref: unknown) => Promise<number>;
};

export async function extractPdfText(
  buffer: Buffer,
  filename: string,
): Promise<{ text: string; pages: number }> {
  const doc = await openPdf(buffer, filename, MAX_BYTES);
  if (doc.numPages > MAX_PAGES) {
    throw new AppError(
      `This PDF has ${doc.numPages} pages (limit ${MAX_PAGES} for the POC). Upload selected chapters or paste the contents page.`,
      "pdf_too_many_pages",
      400,
    );
  }
  const text = await readMarkedPages(doc, 1, doc.numPages);
  if (text.replace(/--- PDF page \d+ ---/g, "").trim().length < 40) {
    throw new AppError(
      "This PDF looks image-only or has no extractable text. OCR is not in this POC. Paste the chapter list instead.",
      "pdf_image_only",
      400,
    );
  }
  return { text, pages: doc.numPages };
}

export async function extractChapterFromPdf(
  buffer: Buffer,
  filename: string,
  input: { title: string; nextTitles: string[] },
): Promise<{ text: string; pdfPageStart: number | null; pdfPageEnd: number | null; pages: number }> {
  const doc = await openPdf(buffer, filename, LIBRARY_MAX_BYTES);
  if (doc.numPages > LIBRARY_MAX_SCAN_PAGES) {
    throw new AppError(
      `${filename} has ${doc.numPages} pages. The library reader scans up to ${LIBRARY_MAX_SCAN_PAGES}. Split the PDF or paste this chapter.`,
      "pdf_too_many_pages",
      400,
    );
  }
  const marked = await readMarkedPages(doc, 1, doc.numPages);
  const sliced =
    sliceLongestChapter(marked, input.title, input.nextTitles) ??
    sliceLongestChapter(marked, input.title, []);
  if (!sliced) {
    throw new AppError(
      `Could not find a chapter body for “${input.title}” in ${filename}. The PDF title may differ, or the pages are image-only. OCR is not in this proof of concept.`,
      "chapter_not_in_pdf",
      400,
    );
  }
  const text = capMarkedPages(sliced.excerpt, LIBRARY_MAX_CHAPTER_PAGES);
  const bounds = pdfPageBounds(text);
  return {
    text,
    pdfPageStart: sliced.pdfPageStart ?? bounds.pdfPageStart,
    pdfPageEnd: bounds.pdfPageEnd ?? sliced.pdfPageEnd,
    pages: doc.numPages,
  };
}

async function openPdf(buffer: Buffer, filename: string, maxBytes: number): Promise<PdfDoc> {
  if (buffer.byteLength > maxBytes) {
    throw new AppError(
      `${filename} is larger than ${Math.round(maxBytes / (1024 * 1024))} MB.${
        maxBytes <= MAX_BYTES
          ? " Upload a shorter file, or attach the full book from your PDF library folder."
          : ""
      }`,
      "pdf_too_large",
      400,
    );
  }
  let pdfjs: typeof import("pdfjs-dist/legacy/build/pdf.mjs");
  try {
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch {
    throw new AppError(
      `Could not initialize PDF parsing for ${filename}. Paste the chapter text instead.`,
      "pdf_unreadable",
      400,
    );
  }
  try {
    const loading = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      isEvalSupported: false,
    });
    return await loading.promise;
  } catch {
    throw new AppError(
      `Could not read ${filename}. The file may be malformed. Paste the chapter text instead.`,
      "pdf_unreadable",
      400,
    );
  }
}

/** Read a known PDF page span. Does not scan the rest of the file. */
export async function extractPdfPageRange(
  buffer: Buffer,
  filename: string,
  start: number,
  end: number,
): Promise<string> {
  const doc = await openPdf(buffer, filename, LIBRARY_MAX_BYTES);
  const first = Math.min(doc.numPages, Math.max(1, start));
  const last = Math.min(doc.numPages, Math.max(first, end), first + LIBRARY_MAX_CHAPTER_PAGES - 1);
  return readMarkedPages(doc, first, last);
}

export async function extractFrontMatter(
  buffer: Buffer,
  filename: string,
  maxPages = 16,
): Promise<{ text: string; pagesRead: number; pages: number }> {
  const doc = await openPdf(buffer, filename, LIBRARY_MAX_BYTES);
  const pagesRead = Math.min(doc.numPages, maxPages);
  const text = await readMarkedPages(doc, 1, pagesRead);
  return { text, pagesRead, pages: doc.numPages };
}

/** Prefer the PDF bookmark tree, then overlay printed pages from the contents scan. */
export async function extractChaptersFromPdf(
  buffer: Buffer,
  filename: string,
): Promise<{ outline: OutlineChapter[]; provenanceLabel: string; text: string }> {
  const doc = await openPdf(buffer, filename, LIBRARY_MAX_BYTES);
  const pagesRead = Math.min(doc.numPages, TOC_SCAN_PAGES);
  const frontMatter = await readMarkedPages(doc, 1, pagesRead);
  const toc = parseTableOfContents(frontMatter);
  const bookmarks = (await doc.getOutline?.()) ?? [];
  if (bookmarks.length) {
    const pages = new Map<PdfBookmark, number | null>();
    await resolveBookmarkPages(doc, bookmarks, pages);
    const fromBookmarks = outlineFromPdfBookmarks(bookmarks, (node) => pages.get(node) ?? null);
    if (fromBookmarks.length) {
      const outline = overlayPrintedPages(fromBookmarks, toc);
      return {
        outline,
        text: chapterListText(outline, frontMatter),
        provenanceLabel: toc.some((row) => row.pageStart)
          ? `Chapter list from PDF bookmarks, with printed pages from the first ${pagesRead} pages of ${filename}`
          : `Chapter list from the PDF bookmarks in ${filename}`,
      };
    }
  }
  const outline = toc.length
    ? overlayPrintedPages([], toc)
    : assignPdfPageIndices(frontMatter, parseOutlineFromText(frontMatter));
  return {
    outline,
    text: chapterListText(outline, frontMatter),
    provenanceLabel:
      outline.length > 0
        ? `Chapter headings and printed pages read from the first ${pagesRead} pages of ${filename}`
        : `No bookmarks or numbered chapter list found in ${filename}`,
  };
}

function chapterListText(outline: OutlineChapter[], frontMatter: string): string {
  const listed = outline
    .map((chapter) => {
      const pages =
        chapter.pageStart && chapter.pageEnd
          ? `${chapter.pageStart}–${chapter.pageEnd}`
          : chapter.pageStart ?? "";
      return `${chapter.number ?? ""} ${chapter.title} ${pages}`.trim();
    })
    .join("\n");
  return listed ? `${listed}\n\n${frontMatter}` : frontMatter;
}

async function resolveBookmarkPages(
  doc: PdfDoc,
  nodes: PdfBookmark[],
  pages: Map<PdfBookmark, number | null>,
): Promise<void> {
  for (const node of nodes) {
    pages.set(node, await destPage(doc, node.dest ?? null));
    if (node.items?.length) await resolveBookmarkPages(doc, node.items, pages);
  }
}

async function destPage(doc: PdfDoc, dest: unknown): Promise<number | null> {
  if (!dest) return null;
  let explicit: unknown = dest;
  if (typeof dest === "string" && doc.getDestination) {
    try {
      explicit = await doc.getDestination(dest);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(explicit) || !explicit[0] || !doc.getPageIndex) return null;
  try {
    const index = await doc.getPageIndex(explicit[0]);
    return Number.isInteger(index) ? index + 1 : null;
  } catch {
    return null;
  }
}

async function readMarkedPages(doc: PdfDoc, start: number, end: number): Promise<string> {
  const parts: string[] = [];
  for (let i = start; i <= end; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    parts.push(`\n\n--- PDF page ${i} ---\n${pageItemsToText(content.items)}`);
  }
  return parts.join("\n").trim();
}

function pageItemsToText(items: unknown[]): string {
  const lines: string[] = [];
  let line = "";
  let lastY: number | null = null;
  for (const item of items) {
    if (!item || typeof item !== "object" || !("str" in item)) continue;
    const row = item as { str?: string; hasEOL?: boolean; transform?: number[] };
    const str = String(row.str ?? "");
    if (!str) continue;
    const y = Array.isArray(row.transform) ? row.transform[5] : undefined;
    if (lastY != null && y != null && Math.abs(y - lastY) > 2 && line.trim()) {
      lines.push(line.trim());
      line = "";
    }
    line += (line ? " " : "") + str;
    if (row.hasEOL) {
      if (line.trim()) lines.push(line.trim());
      line = "";
      lastY = null;
      continue;
    }
    if (typeof y === "number") lastY = y;
  }
  if (line.trim()) lines.push(line.trim());
  return lines.join("\n");
}

export const PDF_LIMITS = {
  maxBytes: MAX_BYTES,
  maxPages: MAX_PAGES,
  libraryMaxBytes: LIBRARY_MAX_BYTES,
  libraryMaxChapterPages: LIBRARY_MAX_CHAPTER_PAGES,
};
