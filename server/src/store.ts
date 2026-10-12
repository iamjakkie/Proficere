import crypto from "node:crypto";
import { v4 as uuid } from "uuid";
import type { Db } from "./db.js";
import {
  applyProgress,
  BookCategorySchema,
  chapterCompleteKey,
  continentLayout,
  createCategory,
  DEFAULT_BOOK_CATEGORIES,
  EXTRACTION_VERSION,
  isDue,
  gradeAnswer,
  isWeakQuiz,
  nextReviewDate,
  parseOutlineFromText,
  passageExistsInSource,
  planProgress,
  reconstructIsland,
  PDF_POSITION_PREFIX,
  creditVisitedPage,
  growthForBook,
  hasPdfSpans,
  trunkBlocks,
  treeTypeForBook,
  reviewCompleteKey,
  titleGroundedInSource,
  unlockForNewChapterCount,
  unlockForReviewCount,
  type Book,
  type BookCategory,
  type Chapter,
  type OutlineChapter,
  type QuizQuestion,
  type Flashcard,
  type ReviewPack,
  type RewardEvent,
  AppError,
  OutlineChapterSchema,
  isSubstantialChapter,
} from "@progress-island/shared";

export function nowIso(): string {
  return new Date().toISOString();
}

export function hashText(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export function logActivity(db: Db, event: string, payload?: unknown): void {
  db.prepare(
    "INSERT INTO activity_log (id, event, payload, created_at) VALUES (?, ?, ?, ?)",
  ).run(uuid(), event, payload ? JSON.stringify(payload) : null, nowIso());
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function mapBook(row: Record<string, unknown>): Book {
  return {
    id: row.id as string,
    title: row.title as string,
    author: (row.author as string) ?? null,
    edition: (row.edition as string) ?? null,
    isbn: (row.isbn as string) ?? null,
    identifiers: parseJson(String(row.identifiers ?? "{}"), {}),
    catalogUrl: (row.catalog_url as string) ?? null,
    contentsAvailable: Boolean(row.contents_available),
    libraryFilename: (row.library_filename as string) ?? null,
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function mapChapter(row: Record<string, unknown>): Chapter {
  return {
    id: row.id as string,
    bookId: row.book_id as string,
    sourceDocumentId: (row.source_document_id as string) ?? null,
    parentId: (row.parent_id as string) ?? null,
    number: (row.number as string) ?? null,
    title: row.title as string,
    outlinePosition: Number(row.outline_position),
    pageStart: (row.page_start as string) ?? null,
    pageEnd: (row.page_end as string) ?? null,
    pdfPageStart: row.pdf_page_start == null ? null : Number(row.pdf_page_start),
    pdfPageEnd: row.pdf_page_end == null ? null : Number(row.pdf_page_end),
    sourceSpanStart:
      row.source_span_start == null ? null : Number(row.source_span_start),
    sourceSpanEnd: row.source_span_end == null ? null : Number(row.source_span_end),
    selected: Boolean(row.selected),
    printed: Boolean(row.printed),
    progressPercent: Number(row.progress_percent),
    status: row.status as Chapter["status"],
    note: (row.note as string) ?? null,
    pagePosition: (row.page_position as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function getBook(db: Db, id: string): Book {
  const row = db.prepare("SELECT * FROM books WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw new AppError("Book not found.", "not_found", 404);
  return mapBook(row);
}

export function listBooks(db: Db): Book[] {
  return (
    db
      .prepare("SELECT * FROM books ORDER BY sort_order ASC, created_at ASC")
      .all() as Record<string, unknown>[]
  ).map(mapBook);
}

export function reorderBooks(db: Db, ids: string[]): Book[] {
  const current = listBooks(db);
  if (ids.length !== current.length) {
    throw new AppError("Send every library book id exactly once.", "book_order", 400);
  }
  const known = new Set(current.map((book) => book.id));
  if (new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
    throw new AppError("Send every library book id exactly once.", "book_order", 400);
  }
  const update = db.prepare("UPDATE books SET sort_order = ? WHERE id = ?");
  const apply = db.transaction(() => {
    ids.forEach((id, index) => update.run(index, id));
  });
  apply();
  logActivity(db, "library_reordered", { count: ids.length });
  return listBooksForLibrary(db);
}

export function listBooksForLibrary(db: Db): Array<
  Book & { progressPercent: number; readPdfPage: number | null; pdfPageCount: number | null }
> {
  return listBooks(db).map((book) => {
    const growth = growthForBook(listChapters(db, book.id), book.identifiers);
    return {
      ...book,
      progressPercent: Math.round(Math.min(1, Math.max(0, growth)) * 100),
      readPdfPage: storedPdfPage(book.identifiers.readPdfPage),
      pdfPageCount: storedPdfPage(book.identifiers.pdfPageCount),
    };
  });
}

export function createBook(
  db: Db,
  input: {
    title: string;
    author?: string | null;
    edition?: string | null;
    isbn?: string | null;
    catalogUrl?: string | null;
    contentsAvailable?: boolean;
    identifiers?: Record<string, string>;
  },
): Book {
  const id = uuid();
  const ts = nowIso();
  const sortOrder = (
    db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM books").get() as { n: number }
  ).n;
  db.prepare(
    `INSERT INTO books (id, title, author, edition, isbn, identifiers, catalog_url, contents_available, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.title,
    input.author ?? null,
    input.edition ?? null,
    input.isbn ?? null,
    JSON.stringify(input.identifiers ?? {}),
    input.catalogUrl ?? null,
    input.contentsAvailable ? 1 : 0,
    sortOrder,
    ts,
    ts,
  );
  logActivity(db, "book_created", { id, title: input.title });
  return getBook(db, id);
}

export function listChapters(db: Db, bookId: string): Chapter[] {
  return (
    db
      .prepare(
        "SELECT * FROM chapters WHERE book_id = ? ORDER BY outline_position ASC",
      )
      .all(bookId) as Record<string, unknown>[]
  ).map(mapChapter);
}

export function getChapter(db: Db, id: string): Chapter {
  const row = db.prepare("SELECT * FROM chapters WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw new AppError("Chapter not found.", "not_found", 404);
  return mapChapter(row);
}

export function insertSource(
  db: Db,
  input: {
    bookId: string;
    provenanceType: string;
    provenanceLabel: string;
    text: string;
    url?: string | null;
    filename?: string | null;
    pageLocator?: string | null;
    editionNote?: string | null;
    aiConsentAt?: string | null;
    outline?: OutlineChapter[] | null;
  },
): { id: string; textHash: string } {
  const id = uuid();
  const textHash = hashText(input.text);
  db.prepare(
    `INSERT INTO source_documents
     (id, book_id, provenance_type, provenance_label, url, filename, page_locator, edition_note, text, text_hash, extraction_version, ai_consent_at, created_at, outline_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.bookId,
    input.provenanceType,
    input.provenanceLabel,
    input.url ?? null,
    input.filename ?? null,
    input.pageLocator ?? null,
    input.editionNote ?? null,
    input.text,
    textHash,
    EXTRACTION_VERSION,
    input.aiConsentAt ?? null,
    nowIso(),
    input.outline ? JSON.stringify(input.outline) : null,
  );
  return { id, textHash };
}

export function confirmChapters(
  db: Db,
  bookId: string,
  sourceDocumentId: string | null,
  outline: OutlineChapter[],
  merge: boolean,
): { chapters: Chapter[]; mergePreview?: MergePreview } {
  const grounded = outline.filter((c) => c.title.trim());
  if (grounded.length === 0) {
    throw new AppError("No chapters to save.", "empty_outline", 400);
  }
  const existing = listChapters(db, bookId);
  if (existing.length && !merge) {
    throw new AppError(
      "This book already has chapters. Review the merge preview before replacing the outline.",
      "merge_required",
      409,
      buildMergePreview(existing, grounded),
    );
  }
  if (existing.length && merge) {
    return applyMerge(db, bookId, sourceDocumentId, existing, grounded);
  }
  const ts = nowIso();
  const insert = db.prepare(
    `INSERT INTO chapters
     (id, book_id, source_document_id, parent_id, number, title, outline_position, page_start, page_end, pdf_page_start, pdf_page_end, source_span_start, source_span_end, selected, printed, progress_percent, status, note, page_position, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, 'not_started', NULL, NULL, ?, ?)`,
  );
  grounded.forEach((chapter, index) => {
    insert.run(
      uuid(),
      bookId,
      sourceDocumentId,
      chapter.number ?? null,
      chapter.title,
      index,
      chapter.pageStart ?? null,
      chapter.pageEnd ?? null,
      chapter.pdfPageStart ?? null,
      chapter.pdfPageEnd ?? null,
      chapter.sourceSpanStart ?? null,
      chapter.sourceSpanEnd ?? null,
      ts,
      ts,
    );
  });
  db.prepare(
    "UPDATE books SET contents_available = 1, updated_at = ? WHERE id = ?",
  ).run(ts, bookId);
  return { chapters: listChapters(db, bookId) };
}

export type MergePreview = {
  keep: { existingId: string; title: string; incomingTitle: string }[];
  add: OutlineChapter[];
  drop: { existingId: string; title: string; status: string }[];
};

function chapterMatchKey(number: string | null | undefined, title: string): string {
  return `${(number ?? "").trim().toLowerCase()}|${title.trim().toLowerCase()}`;
}

export function buildMergePreview(
  existing: Chapter[],
  incoming: OutlineChapter[],
): MergePreview {
  const incomingKeys = new Map(
    incoming.map((c) => [chapterMatchKey(c.number, c.title), c]),
  );
  const keep: MergePreview["keep"] = [];
  const drop: MergePreview["drop"] = [];
  const used = new Set<string>();
  for (const ch of existing) {
    const key = chapterMatchKey(ch.number, ch.title);
    const match = incomingKeys.get(key);
    if (match) {
      keep.push({ existingId: ch.id, title: ch.title, incomingTitle: match.title });
      used.add(key);
    } else {
      drop.push({ existingId: ch.id, title: ch.title, status: ch.status });
    }
  }
  const add = incoming.filter((c) => !used.has(chapterMatchKey(c.number, c.title)));
  return { keep, add, drop };
}

function applyMerge(
  db: Db,
  bookId: string,
  sourceDocumentId: string | null,
  existing: Chapter[],
  incoming: OutlineChapter[],
): { chapters: Chapter[]; mergePreview: MergePreview } {
  const preview = buildMergePreview(existing, incoming);
  const ts = nowIso();
  const byKey = new Map(existing.map((c) => [chapterMatchKey(c.number, c.title), c]));
  const byId = new Map(existing.map((chapter) => [chapter.id, chapter]));
  const used = new Set<string>();
  incoming.forEach((chapter, index) => {
    const linked =
      (chapter.existingId ? byId.get(chapter.existingId) : undefined) ??
      byKey.get(chapterMatchKey(chapter.number, chapter.title));
    const prior = linked && !used.has(linked.id) ? linked : undefined;
    if (prior) {
      used.add(prior.id);
      db.prepare(
        `UPDATE chapters SET source_document_id = ?, number = ?, title = ?, outline_position = ?,
         page_start = ?, page_end = ?, pdf_page_start = ?, pdf_page_end = ?,
         source_span_start = ?, source_span_end = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        sourceDocumentId ?? prior.sourceDocumentId,
        chapter.number ?? null,
        chapter.title,
        index,
        chapter.pageStart ?? prior.pageStart,
        chapter.pageEnd ?? prior.pageEnd,
        chapter.pdfPageStart ?? prior.pdfPageStart,
        chapter.pdfPageEnd ?? prior.pdfPageEnd,
        chapter.sourceSpanStart ?? prior.sourceSpanStart,
        chapter.sourceSpanEnd ?? prior.sourceSpanEnd,
        ts,
        prior.id,
      );
    } else {
      db.prepare(
        `INSERT INTO chapters
         (id, book_id, source_document_id, parent_id, number, title, outline_position, page_start, page_end, pdf_page_start, pdf_page_end, source_span_start, source_span_end, selected, printed, progress_percent, status, note, page_position, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, 'not_started', NULL, NULL, ?, ?)`,
      ).run(
        uuid(),
        bookId,
        sourceDocumentId,
        chapter.number ?? null,
        chapter.title,
        index,
        chapter.pageStart ?? null,
        chapter.pageEnd ?? null,
        chapter.pdfPageStart ?? null,
        chapter.pdfPageEnd ?? null,
        chapter.sourceSpanStart ?? null,
        chapter.sourceSpanEnd ?? null,
        ts,
        ts,
      );
    }
  });
  db.prepare("UPDATE books SET updated_at = ? WHERE id = ?").run(ts, bookId);
  return { chapters: listChapters(db, bookId), mergePreview: preview };
}

export function chapterStateSnapshot(ch: Chapter) {
  return {
    progressPercent: ch.progressPercent,
    status: ch.status,
    note: ch.note,
    pagePosition: ch.pagePosition,
    selected: ch.selected,
    printed: ch.printed,
  };
}

export function updateChapter(
  db: Db,
  id: string,
  patch: Partial<{
    selected: boolean;
    printed: boolean;
    progressPercent: number;
    note: string | null;
    pagePosition: string | null;
  }>,
): Chapter {
  const current = getChapter(db, id);
  let progressPercent = current.progressPercent;
  let status = current.status;
  if (patch.progressPercent != null) {
    const next = applyProgress(current, patch.progressPercent);
    progressPercent = next.progressPercent;
    status = next.status;
  }
  const ts = nowIso();
  const nextChapter: Chapter = {
    ...current,
    selected: patch.selected ?? current.selected,
    printed: patch.printed ?? current.printed,
    progressPercent,
    status,
    note: patch.note !== undefined ? patch.note : current.note,
    pagePosition:
      patch.pagePosition !== undefined ? patch.pagePosition : current.pagePosition,
    updatedAt: ts,
  };
  const unchanged =
    nextChapter.selected === current.selected &&
    nextChapter.printed === current.printed &&
    nextChapter.progressPercent === current.progressPercent &&
    nextChapter.status === current.status &&
    nextChapter.note === current.note &&
    nextChapter.pagePosition === current.pagePosition;
  if (unchanged) return current;
  const eventId = uuid();
  db.prepare(
    `INSERT INTO progress_events (id, chapter_id, old_state, new_state, note, created_at, undone_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`,
  ).run(
    eventId,
    id,
    JSON.stringify(chapterStateSnapshot(current)),
    JSON.stringify(chapterStateSnapshot(nextChapter)),
    patch.note ?? null,
    ts,
  );
  db.prepare(
    `UPDATE chapters SET selected = ?, printed = ?, progress_percent = ?, status = ?, note = ?, page_position = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    nextChapter.selected ? 1 : 0,
    nextChapter.printed ? 1 : 0,
    nextChapter.progressPercent,
    nextChapter.status,
    nextChapter.note,
    nextChapter.pagePosition,
    ts,
    id,
  );
  maybeGrantChapterReward(db, nextChapter);
  logActivity(db, "progress_update", { chapterId: id, status: nextChapter.status });
  return getChapter(db, id);
}

const READING_NOTE = "Read in the PDF viewer";

export function recordReading(
  db: Db,
  bookId: string,
  page: number,
  pageCount: number,
): { book: Book; chapters: Chapter[] } {
  if (!Number.isInteger(page) || !Number.isInteger(pageCount) || page < 1 || page > pageCount) {
    throw new AppError("That page is outside this PDF.", "validation", 400);
  }
  const book = getBook(db, bookId);
  const chapters = listChapters(db, bookId);
  const stored = Number(book.identifiers.readPdfPage);
  const bookReadPage = Number.isInteger(stored) && stored > 0 ? stored : 0;
  const credited = creditVisitedPage(chapters, page, pageCount, bookReadPage);
  for (const credit of credited.credits) {
    writeReadingProgress(db, credit.id, credit.progressPercent, credit.creditedPdfPage);
  }
  const extra: Record<string, string> = {
    lastPdfPage: String(page),
    pdfPageCount: String(pageCount),
  };
  if (!hasPdfSpans(chapters) && credited.bookReadPage > 0) {
    extra.readPdfPage = String(credited.bookReadPage);
  }
  mergeBookIdentifiers(db, bookId, extra);
  logActivity(db, "reading_progress", { bookId, page, pageCount });
  return { book: getBook(db, bookId), chapters: listChapters(db, bookId) };
}

function writeReadingProgress(db: Db, id: string, progressPercent: number, creditedPdfPage: number): void {
  const current = getChapter(db, id);
  if (progressPercent <= current.progressPercent) return;
  const next = applyProgress(current, progressPercent);
  const ts = nowIso();
  const pagePosition = `${PDF_POSITION_PREFIX}${creditedPdfPage}`;
  const nextChapter: Chapter = {
    ...current,
    progressPercent: next.progressPercent,
    status: next.status,
    pagePosition,
    updatedAt: ts,
  };
  const last = db
    .prepare(
      `SELECT * FROM progress_events WHERE chapter_id = ? AND undone_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(id) as { id: string; note: string | null } | undefined;
  if (last?.note === READING_NOTE) {
    db.prepare("UPDATE progress_events SET new_state = ? WHERE id = ?").run(
      JSON.stringify(chapterStateSnapshot(nextChapter)),
      last.id,
    );
  } else {
    db.prepare(
      `INSERT INTO progress_events (id, chapter_id, old_state, new_state, note, created_at, undone_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    ).run(
      uuid(),
      id,
      JSON.stringify(chapterStateSnapshot(current)),
      JSON.stringify(chapterStateSnapshot(nextChapter)),
      READING_NOTE,
      ts,
    );
  }
  db.prepare(
    `UPDATE chapters SET progress_percent = ?, status = ?, page_position = ?, updated_at = ? WHERE id = ?`,
  ).run(nextChapter.progressPercent, nextChapter.status, pagePosition, ts, id);
  maybeGrantChapterReward(db, nextChapter);
}

export function undoLastProgress(db: Db, chapterId: string): Chapter {
  const event = db
    .prepare(
      `SELECT * FROM progress_events WHERE chapter_id = ? AND undone_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(chapterId) as Record<string, unknown> | undefined;
  if (!event) throw new AppError("Nothing to undo for this chapter.", "nothing_to_undo", 400);
  const oldState = parseJson(String(event.old_state), {
    progressPercent: 0,
    status: "not_started",
    note: null,
    pagePosition: null,
    selected: true,
    printed: false,
  }) as ReturnType<typeof chapterStateSnapshot>;
  const ts = nowIso();
  db.prepare("UPDATE progress_events SET undone_at = ? WHERE id = ?").run(
    ts,
    event.id,
  );
  db.prepare(
    `UPDATE chapters SET selected = ?, printed = ?, progress_percent = ?, status = ?, note = ?, page_position = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    oldState.selected ? 1 : 0,
    oldState.printed ? 1 : 0,
    oldState.progressPercent,
    oldState.status,
    oldState.note,
    oldState.pagePosition,
    ts,
    chapterId,
  );
  return getChapter(db, chapterId);
}

function maybeGrantChapterReward(db: Db, chapter: Chapter): void {
  if (chapter.status !== "completed") return;
  const key = chapterCompleteKey(chapter.id);
  const exists = db.prepare("SELECT id FROM reward_events WHERE reward_key = ?").get(key);
  if (exists) return;
  const completed = (
    db.prepare("SELECT id FROM chapters WHERE status = 'completed'").all() as { id: string }[]
  ).length;
  const unlock = unlockForNewChapterCount(completed) ?? "grove";
  db.prepare(
    `INSERT INTO reward_events (id, reward_key, kind, unlock, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(uuid(), key, "chapter_complete", unlock, nowIso());
}

export function listRewards(db: Db): RewardEvent[] {
  return (
    db.prepare("SELECT * FROM reward_events ORDER BY created_at ASC").all() as Record<
      string,
      unknown
    >[]
  ).map((row) => ({
    id: row.id as string,
    rewardKey: row.reward_key as string,
    kind: row.kind as string,
    unlock: row.unlock as string,
    createdAt: row.created_at as string,
  }));
}

export function islandState(db: Db) {
  return reconstructIsland(listRewards(db));
}

function storedPdfPage(value: string | undefined): number | null {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : null;
}

export function islandTrees(db: Db) {
  const categories = listCategories(db);
  return listBooks(db)
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((book) => {
      const chapters = listChapters(db, book.id);
      const growth = growthForBook(chapters, book.identifiers);
      const categoryId = book.identifiers.category?.trim() || null;
      const category = categories.find((item) => item.id === categoryId);
      return {
        bookId: book.id,
        title: book.title,
        author: book.author,
        coverUrl: book.identifiers.coverUrl?.trim() || null,
        growth,
        trunkBlocks: trunkBlocks(growth),
        treeType: category?.tree || treeTypeForBook(book.identifiers),
        category: categoryId,
        hasPdf: Boolean(book.libraryFilename),
        readPdfPage: storedPdfPage(book.identifiers.readPdfPage),
        pdfPageCount: storedPdfPage(book.identifiers.pdfPageCount),
        lastPdfPage: storedPdfPage(book.identifiers.lastPdfPage),
      };
    });
}

export function printQueue(db: Db) {
  const rows = db
    .prepare(
      `SELECT chapters.*, books.title AS book_title, books.edition AS book_edition
       FROM chapters JOIN books ON books.id = chapters.book_id
       WHERE chapters.printed = 1
       ORDER BY books.title, chapters.outline_position`,
    )
    .all() as Record<string, unknown>[];
  return rows.map((row) => ({
    bookTitle: row.book_title as string,
    edition: (row.book_edition as string) ?? null,
    chapter: mapChapter(row),
    pageRange:
      row.page_start && row.page_end
        ? `${row.page_start}–${row.page_end}`
        : row.page_start
          ? String(row.page_start)
          : row.page_end
            ? `through ${row.page_end}`
            : "unknown",
  }));
}

export function latestPack(db: Db, chapterId: string): ReviewPack | null {
  const row = db
    .prepare(
      "SELECT * FROM review_packs WHERE chapter_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .get(chapterId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return mapPack(row);
}

function mapPack(row: Record<string, unknown>): ReviewPack {
  return {
    id: row.id as string,
    chapterId: row.chapter_id as string,
    sourceDocumentId: row.source_document_id as string,
    sourceHash: row.source_hash as string,
    stale: Boolean(row.stale),
    flashcards: parseJson(String(row.flashcards), []),
    questions: parseJson(String(row.questions), []),
    createdAt: row.created_at as string,
  };
}

export function saveReviewPack(
  db: Db,
  input: {
    chapterId: string;
    sourceDocumentId: string;
    sourceHash: string;
    flashcards: unknown;
    questions: unknown;
  },
): ReviewPack {
  const id = uuid();
  db.prepare(
    `INSERT INTO review_packs (id, chapter_id, source_document_id, source_hash, stale, flashcards, questions, created_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
  ).run(
    id,
    input.chapterId,
    input.sourceDocumentId,
    input.sourceHash,
    JSON.stringify(input.flashcards),
    JSON.stringify(input.questions),
    nowIso(),
  );
  return latestPack(db, input.chapterId)!;
}

export function markStalePacks(db: Db, chapterId: string, sourceHash: string): void {
  db.prepare(
    "UPDATE review_packs SET stale = 1 WHERE chapter_id = ? AND source_hash != ?",
  ).run(chapterId, sourceHash);
}

export function scoreAttempt(
  db: Db,
  packId: string,
  answers: Record<string, string>,
): {
  attemptId: string;
  correctCount: number;
  total: number;
  weak: boolean;
  nextReviewAt: string;
} {
  const packRow = db.prepare("SELECT * FROM review_packs WHERE id = ?").get(packId) as
    | Record<string, unknown>
    | undefined;
  if (!packRow) throw new AppError("Review pack not found.", "not_found", 404);
  const pack = mapPack(packRow);
  const questions = pack.questions.filter((question) => !question.rejected);
  if (questions.length === 0) {
    throw new AppError(
      "Every question in this pack was rejected. Restore one or generate the pack again.",
      "empty_pack",
      400,
    );
  }
  let correctCount = 0;
  for (const question of questions) {
    if (gradeAnswer(question, answers[question.id])) correctCount += 1;
  }
  const total = questions.length;
  const weak = isWeakQuiz(correctCount, total);
  const priorSuccess = (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM review_attempts WHERE chapter_id = ? AND weak = 0",
      )
      .get(pack.chapterId) as { n: number }
  ).n;
  const nextReviewAt = nextReviewDate({
    successfulReviewCount: weak ? priorSuccess : priorSuccess,
    weak,
  }).toISOString();
  // After this successful review, interval index should be priorSuccess (0-based next interval)
  const attemptId = uuid();
  const ts = nowIso();
  db.prepare(
    `INSERT INTO review_attempts (id, pack_id, chapter_id, answers, correct_count, total, weak, next_review_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    attemptId,
    packId,
    pack.chapterId,
    JSON.stringify(answers),
    correctCount,
    total,
    weak ? 1 : 0,
    nextReviewAt,
    ts,
  );
  if (!weak) {
    const ordinal = priorSuccess + 1;
    const key = reviewCompleteKey(pack.chapterId, ordinal);
    const exists = db.prepare("SELECT id FROM reward_events WHERE reward_key = ?").get(key);
    if (!exists) {
      const unlock = unlockForReviewCount(ordinal) ?? "wildflowers";
      db.prepare(
        `INSERT INTO reward_events (id, reward_key, kind, unlock, created_at) VALUES (?, ?, ?, ?, ?)`,
      ).run(uuid(), key, "review_success", unlock, ts);
    }
  }
  logActivity(db, "review_attempt", { packId, correctCount, total, weak });
  return { attemptId, correctCount, total, weak, nextReviewAt };
}

export function dueReviews(db: Db, now = new Date()) {
  const rows = db
    .prepare(
      `SELECT ra.chapter_id, ra.next_review_at, ra.pack_id
       FROM review_attempts ra
       JOIN (
         SELECT chapter_id, MAX(created_at) AS latest FROM review_attempts GROUP BY chapter_id
       ) latest ON latest.chapter_id = ra.chapter_id AND latest.latest = ra.created_at`,
    )
    .all() as { chapter_id: string; next_review_at: string; pack_id: string }[];
  return rows
    .filter((row) => isDue(row.next_review_at, now))
    .map((row) => ({
      chapter: getChapter(db, row.chapter_id),
      nextReviewAt: row.next_review_at,
      packId: row.pack_id,
    }));
}

export function nextSelectedChapter(db: Db): { chapter: Chapter; bookTitle: string } | null {
  const row = db
    .prepare(
      `SELECT chapters.*, books.title AS book_title
       FROM chapters JOIN books ON books.id = chapters.book_id
       WHERE chapters.selected = 1 AND chapters.status != 'completed'
       ORDER BY CASE chapters.status WHEN 'in_progress' THEN 0 ELSE 1 END,
                books.updated_at DESC,
                chapters.outline_position ASC
       LIMIT 1`,
    )
    .get() as Record<string, unknown> | undefined;
  if (!row) return null;
  return { chapter: mapChapter(row), bookTitle: String(row.book_title) };
}

export function dashboardPlan(db: Db) {
  const chapters = (
    db.prepare("SELECT selected, status FROM chapters").all() as {
      selected: number;
      status: Chapter["status"];
    }[]
  ).map((c) => ({ selected: Boolean(c.selected), status: c.status }));
  return planProgress(chapters);
}

export function getSource(db: Db, id: string) {
  const row = db.prepare("SELECT * FROM source_documents WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw new AppError("Source document not found.", "not_found", 404);
  return row;
}

export function latestSourceForBook(db: Db, bookId: string) {
  return db
    .prepare(
      "SELECT * FROM source_documents WHERE book_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .get(bookId) as Record<string, unknown> | undefined;
}

export function draftOutlineForBook(db: Db, bookId: string): OutlineChapter[] | null {
  const source = latestSourceForBook(db, bookId);
  if (!source?.outline_json) return null;
  const parsed = OutlineChapterSchema.array().safeParse(parseJson(String(source.outline_json), []));
  return parsed.success ? parsed.data : null;
}

export function dismissedSourceId(db: Db, bookId: string): string | null {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(`dismissed_source:${bookId}`) as { value: string } | undefined;
  return row?.value ?? null;
}

export function dismissLatestSource(db: Db, bookId: string): void {
  const source = latestSourceForBook(db, bookId);
  if (!source) return;
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(`dismissed_source:${bookId}`, source.id);
}

export function refreshPackStale(db: Db, chapterId: string): ReviewPack | null {
  const pack = latestPack(db, chapterId);
  if (!pack) return null;
  const chapter = getChapter(db, chapterId);
  if (!chapter.sourceDocumentId) return pack;
  const source = getSource(db, chapter.sourceDocumentId);
  if (String(source.text_hash) !== pack.sourceHash && !pack.stale) {
    db.prepare("UPDATE review_packs SET stale = 1 WHERE id = ?").run(pack.id);
    return { ...pack, stale: true };
  }
  return pack;
}

export function updateReviewItem(
  db: Db,
  packId: string,
  input: {
    kind: "flashcard" | "question";
    id: string;
    action: "edit" | "reject" | "restore" | "report";
    front?: string;
    back?: string;
    prompt?: string;
    reportNote?: string | null;
  },
): ReviewPack {
  const row = db.prepare("SELECT * FROM review_packs WHERE id = ?").get(packId) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw new AppError("Review pack not found.", "not_found", 404);
  const pack = mapPack(row);
  if (input.kind === "flashcard") {
    const flashcards = pack.flashcards.map((card) =>
      card.id === input.id ? applyCardAction(card, input) : card,
    );
    if (!flashcards.some((card) => card.id === input.id)) {
      throw new AppError("Flashcard not found.", "not_found", 404);
    }
    db.prepare("UPDATE review_packs SET flashcards = ? WHERE id = ?").run(
      JSON.stringify(flashcards),
      packId,
    );
  } else {
    const questions = pack.questions.map((question) =>
      question.id === input.id ? applyQuestionAction(question, input) : question,
    );
    if (!questions.some((question) => question.id === input.id)) {
      throw new AppError("Question not found.", "not_found", 404);
    }
    db.prepare("UPDATE review_packs SET questions = ? WHERE id = ?").run(
      JSON.stringify(questions),
      packId,
    );
  }
  if (input.action === "report") {
    logActivity(db, "review_item_reported", {
      packId,
      itemId: input.id,
      kind: input.kind,
    });
  }
  const updated = db.prepare("SELECT * FROM review_packs WHERE id = ?").get(packId) as Record<
    string,
    unknown
  >;
  return mapPack(updated);
}

function applyCardAction(
  card: Flashcard,
  input: {
    action: "edit" | "reject" | "restore" | "report";
    front?: string;
    back?: string;
    reportNote?: string | null;
  },
): Flashcard {
  if (input.action === "reject") return { ...card, rejected: true };
  if (input.action === "restore") return { ...card, rejected: false };
  if (input.action === "report") {
    return { ...card, reportNote: input.reportNote?.trim() || "Reported as a poor item." };
  }
  const front = input.front?.trim();
  const back = input.back?.trim();
  if (!front || !back) {
    throw new AppError("A flashcard needs both a front and a back.", "validation", 400);
  }
  return { ...card, front, back };
}

function applyQuestionAction(
  question: QuizQuestion,
  input: {
    action: "edit" | "reject" | "restore" | "report";
    prompt?: string;
    reportNote?: string | null;
  },
): QuizQuestion {
  if (input.action === "reject") return { ...question, rejected: true };
  if (input.action === "restore") return { ...question, rejected: false };
  if (input.action === "report") {
    return {
      ...question,
      reportNote: input.reportNote?.trim() || "Reported as a poor item.",
    };
  }
  const prompt = input.prompt?.trim();
  if (!prompt) throw new AppError("A question needs a prompt.", "validation", 400);
  return { ...question, prompt };
}

export function getSetting(db: Db, key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(db: Db, key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

export function deleteSetting(db: Db, key: string): void {
  db.prepare("DELETE FROM settings WHERE key = ?").run(key);
}

const CATEGORIES_KEY = "book_categories";

export function listCategories(db: Db): BookCategory[] {
  const raw = getSetting(db, CATEGORIES_KEY);
  if (raw == null) return continentLayout(DEFAULT_BOOK_CATEGORIES.map((category) => ({ ...category })));
  try {
    const parsed = BookCategorySchema.array().safeParse(JSON.parse(raw));
    if (!parsed.success) return continentLayout(DEFAULT_BOOK_CATEGORIES.map((category) => ({ ...category })));
    return continentLayout(parsed.data);
  } catch {
    return continentLayout(DEFAULT_BOOK_CATEGORIES.map((category) => ({ ...category })));
  }
}

function writeCategories(db: Db, categories: BookCategory[]): void {
  setSetting(db, CATEGORIES_KEY, JSON.stringify(categories));
}

function requireCategoryLabel(label: string, categories: BookCategory[], ignoreId?: string): string {
  const name = label.trim();
  if (!name) throw new AppError("A category needs a name.", "category", 400);
  if (name.length > 40) throw new AppError("Keep the category name under 40 characters.", "category", 400);
  const taken = categories.some(
    (category) => category.id !== ignoreId && category.label.toLowerCase() === name.toLowerCase(),
  );
  if (taken) throw new AppError("That category already exists.", "category", 400);
  return name;
}

export function addCategory(db: Db, label: string): BookCategory[] {
  const categories = listCategories(db);
  if (categories.length >= 24) throw new AppError("24 categories is the limit.", "category", 400);
  const name = requireCategoryLabel(label, categories);
  const next = continentLayout([...categories, createCategory(name, categories)]);
  writeCategories(db, next);
  return next;
}

export function renameCategory(db: Db, id: string, label: string): BookCategory[] {
  const categories = listCategories(db);
  const current = categories.find((category) => category.id === id);
  if (!current) throw new AppError("That category is not on the globe.", "category", 404);
  const name = requireCategoryLabel(label, categories, id);
  const next = continentLayout(
    categories.map((category) => (category.id === id ? { ...category, label: name } : category)),
  );
  writeCategories(db, next);
  return next;
}

export function removeCategory(db: Db, id: string): BookCategory[] {
  const categories = listCategories(db);
  if (!categories.some((category) => category.id === id)) {
    throw new AppError("That category is not on the globe.", "category", 404);
  }
  const next = continentLayout(categories.filter((category) => category.id !== id));
  const apply = db.transaction(() => {
    writeCategories(db, next);
    for (const book of listBooks(db)) {
      if (book.identifiers.category === id) mergeBookIdentifiers(db, book.id, { category: null });
    }
  });
  apply();
  return next;
}

export function mergeBookIdentifiers(
  db: Db,
  bookId: string,
  extra: Record<string, string | null>,
): Book {
  const book = getBook(db, bookId);
  const identifiers = { ...book.identifiers };
  for (const [key, value] of Object.entries(extra)) {
    if (value == null || value === "") delete identifiers[key];
    else identifiers[key] = value;
  }
  db.prepare("UPDATE books SET identifiers = ?, updated_at = ? WHERE id = ?").run(
    JSON.stringify(identifiers),
    nowIso(),
    bookId,
  );
  return getBook(db, bookId);
}

export function setBookCover(
  db: Db,
  bookId: string,
  coverUrl: string | null,
  extra: Record<string, string | null> = {},
): Book {
  return mergeBookIdentifiers(db, bookId, { ...extra, coverUrl });
}

export function attachLibraryFilename(db: Db, bookId: string, filename: string | null): Book {
  getBook(db, bookId);
  db.prepare("UPDATE books SET library_filename = ?, updated_at = ? WHERE id = ?").run(
    filename,
    nowIso(),
    bookId,
  );
  return getBook(db, bookId);
}

export function reuseLibraryExcerpt(
  db: Db,
  chapter: Chapter,
  filename: string,
  mtimeMs: number,
): { id: string; text: string; hash: string } | null {
  if (!chapter.sourceDocumentId) return null;
  const source = getSource(db, chapter.sourceDocumentId);
  const note = `library:${mtimeMs}`;
  if (source.filename !== filename || source.edition_note !== note) return null;
  const text = String(source.text);
  if (!isSubstantialChapter(text, chapter.title)) return null;
  return { id: chapter.sourceDocumentId, text, hash: String(source.text_hash) };
}

export function saveLibraryExcerpt(
  db: Db,
  chapter: Chapter,
  input: {
    filename: string;
    text: string;
    mtimeMs: number;
    pdfPageStart: number | null;
    pdfPageEnd: number | null;
  },
): { id: string; text: string; hash: string } {
  const source = insertSource(db, {
    bookId: chapter.bookId,
    provenanceType: "uploaded",
    provenanceLabel: `Chapter excerpt from library PDF ${input.filename}`,
    text: input.text,
    filename: input.filename,
    pageLocator:
      input.pdfPageStart != null
        ? `PDF pages ${input.pdfPageStart}–${input.pdfPageEnd ?? input.pdfPageStart}`
        : null,
    editionNote: `library:${input.mtimeMs}`,
  });
  db.prepare(
    `UPDATE chapters SET source_document_id = ?, source_span_start = 0, source_span_end = ?,
     pdf_page_start = ?, pdf_page_end = ?, updated_at = ? WHERE id = ?`,
  ).run(
    source.id,
    input.text.length,
    input.pdfPageStart,
    input.pdfPageEnd,
    nowIso(),
    chapter.id,
  );
  return { id: source.id, text: input.text, hash: source.textHash };
}

export function saveWebExcerpt(
  db: Db,
  chapter: Chapter,
  input: { url: string; text: string },
): { id: string; text: string; hash: string } {
  const source = insertSource(db, {
    bookId: chapter.bookId,
    provenanceType: "retrieved",
    provenanceLabel: `Section text from ${input.url}`,
    text: input.text,
    url: input.url,
    aiConsentAt: nowIso(),
  });
  db.prepare(
    `UPDATE chapters SET source_document_id = ?, source_span_start = 0, source_span_end = ?, updated_at = ? WHERE id = ?`,
  ).run(source.id, input.text.length, nowIso(), chapter.id);
  return { id: source.id, text: input.text, hash: source.textHash };
}

export function chapterText(db: Db, chapter: Chapter): string | null {
  if (!chapter.sourceDocumentId) return null;
  const source = getSource(db, chapter.sourceDocumentId);
  const text = String(source.text);
  if (chapter.sourceSpanStart != null && chapter.sourceSpanEnd != null) {
    return text.slice(chapter.sourceSpanStart, chapter.sourceSpanEnd);
  }
  // Fall back to locating the heading in the source without inventing body text.
  if (chapter.title && text.includes(chapter.title)) {
    return excerptAroundTitle(text, chapter.title);
  }
  return text;
}

function excerptAroundTitle(text: string, title: string): string {
  const idx = text.indexOf(title);
  if (idx < 0) return text;
  const next = text.slice(idx + title.length).search(/\n(?:Chapter\s+)?\d+[.:)/]/i);
  const end = next >= 0 ? idx + title.length + next : text.length;
  return text.slice(idx, end);
}

export function filterGroundedOutline(
  outline: OutlineChapter[],
  source: string,
): OutlineChapter[] {
  return outline.filter((c) => titleGroundedInSource(c.title, source));
}

export function localOrEmptyOutline(source: string): OutlineChapter[] {
  return parseOutlineFromText(source);
}

export function exportBackup(db: Db) {
  const tables = [
    "books",
    "source_documents",
    "chapters",
    "progress_events",
    "review_packs",
    "review_attempts",
    "reward_events",
    "settings",
    "activity_log",
    "project_batches",
    "project_dismissals",
    "projects",
    "project_versions",
    "project_submissions",
    "project_reviews",
    "schema_migrations",
  ];
  const payload: Record<string, unknown[]> = {};
  for (const table of tables) {
    payload[table] = db.prepare(`SELECT * FROM ${table}`).all() as unknown[];
  }
  return {
    version: 1,
    exportedAt: nowIso(),
    payload,
  };
}

export function restoreBackup(db: Db, backup: { payload?: Record<string, unknown[]> }): void {
  if (!backup.payload) {
    throw new AppError("Backup file is missing payload.", "invalid_backup", 400);
  }
  const order = [
    "books",
    "source_documents",
    "chapters",
    "progress_events",
    "review_packs",
    "review_attempts",
    "reward_events",
    "settings",
    "activity_log",
    "project_batches",
    "project_dismissals",
    "projects",
    "project_versions",
    "project_submissions",
    "project_reviews",
  ];
  db.exec("BEGIN");
  try {
    for (const table of [...order].reverse()) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
    for (const table of order) {
      const rows = backup.payload[table] ?? [];
      for (const row of rows) {
        const rec = row as Record<string, unknown>;
        const keys = Object.keys(rec);
        const placeholders = keys.map(() => "?").join(", ");
        db.prepare(
          `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders})`,
        ).run(...keys.map((k) => rec[k]));
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export { passageExistsInSource };
