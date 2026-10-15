import fs from "node:fs";
import { hasProse, isSubstantialChapter } from "@progress-island/shared";
import { aiConfigured } from "./config.js";
import type { Db } from "./db.js";
import { bookPdfFile } from "./library.js";
import { generateReviewPackWithAi } from "./openrouter.js";
import { extractPdfPageRange } from "./pdf.js";
import { suggestProjectsWithAi } from "./project-ai.js";
import {
  acceptProposal,
  buildSuggestionContext,
  focusedProject,
  saveBatch,
} from "./project-store.js";
import { fetchSectionFromSite } from "./site-chapter.js";
import {
  chapterText,
  getBook,
  getChapter,
  getSource,
  insertSource,
  latestPack,
  markStalePacks,
  saveReviewPack,
  saveWebExcerpt,
  type ReadingFollowups,
} from "./store.js";

let tail: Promise<void> = Promise.resolve();
const unusable = new Set<string>();

/** Reviews and milestone exams run after the page is saved. A missing source skips quietly. */
export function scheduleReadingFollowups(db: Db, followups: ReadingFollowups): void {
  if (followups.reviewChapterIds.length === 0 && followups.examChapterIds.length === 0) return;
  const reviewIds = [...followups.reviewChapterIds];
  const examIds = [...followups.examChapterIds];
  tail = tail
    .then(async () => {
      for (const chapterId of reviewIds) await ensureReview(db, chapterId);
      if (examIds.length > 0) await ensureExam(db, examIds);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "unknown error";
      console.error(`Reading follow-up failed: ${message}`);
    });
}

async function ensureReview(db: Db, chapterId: string): Promise<void> {
  if (!aiConfigured() || unusable.has(chapterId) || latestPack(db, chapterId)) return;
  const loaded = await loadChapterText(db, chapterId);
  if (!loaded) {
    unusable.add(chapterId);
    return;
  }
  const chapter = getChapter(db, chapterId);
  const source = getSource(db, loaded.sourceId);
  const hash = String(source.text_hash ?? loaded.hash);
  markStalePacks(db, chapter.id, hash);
  const generated = await generateReviewPackWithAi({
    chapterTitle: chapter.title,
    chapterText: loaded.text,
  });
  saveReviewPack(db, {
    chapterId: chapter.id,
    sourceDocumentId: loaded.sourceId,
    sourceHash: hash,
    flashcards: generated.flashcards,
    questions: generated.questions,
  });
}

async function ensureExam(db: Db, chapterIds: string[]): Promise<void> {
  const primary = chapterIds[0];
  if (!primary || !aiConfigured() || examAlreadyExists(db, primary)) return;
  let grounded = false;
  for (const chapterId of chapterIds) {
    const loaded = await loadChapterText(db, chapterId);
    if (loaded) grounded = true;
  }
  if (!grounded) return;
  const context = buildSuggestionContext(db, {
    chapterIds,
    goal: "Check the chapter that was just finished.",
    hours: null,
    output: "",
    tools: "",
    instruction: "One exam for this finished chapter. The reader stays on this chapter until it is passed.",
  });
  const proposals = await suggestProjectsWithAi(context.packet, context.corpus);
  const exam = proposals.find((proposal) => proposal.exam);
  if (!exam) return;
  const batch = saveBatch(
    db,
    context.hash,
    {
      chapterIds,
      goal: "Check the chapter that was just finished.",
      hours: null,
      output: "",
      tools: "",
      instruction: "One exam for this finished chapter.",
    },
    proposals,
  );
  const focused = focusedProject(db);
  const project = acceptProposal(db, batch.id, exam.id, Boolean(focused));
  if (focused) {
    const ts = new Date().toISOString();
    db.prepare("UPDATE projects SET status = 'active', updated_at = ? WHERE id = ?").run(ts, focused.id);
    db.prepare("UPDATE projects SET status = 'paused', updated_at = ? WHERE id = ?").run(ts, project.id);
  }
}

function examAlreadyExists(db: Db, chapterId: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS ok FROM projects p
       LEFT JOIN project_versions v ON v.project_id = p.id
       WHERE p.status != 'dismissed'
         AND (instr(p.brief_json, ?) > 0 OR instr(COALESCE(v.brief_json, ''), ?) > 0)
       LIMIT 1`,
    )
    .get(chapterId, chapterId);
  return Boolean(row);
}

async function loadChapterText(
  db: Db,
  chapterId: string,
): Promise<{ text: string; sourceId: string; hash: string } | null> {
  const chapter = getChapter(db, chapterId);
  const book = getBook(db, chapter.bookId);
  if (book.libraryFilename && chapter.pdfPageStart != null) {
    const end =
      chapter.pdfPageEnd != null && chapter.pdfPageEnd >= chapter.pdfPageStart
        ? chapter.pdfPageEnd
        : chapter.pdfPageStart;
    const note = `pdf-pages:${chapter.pdfPageStart}-${end}`;
    if (chapter.sourceDocumentId) {
      const existing = getSource(db, chapter.sourceDocumentId);
      if (String(existing.edition_note ?? "") === note && usable(String(existing.text ?? ""), chapter.title)) {
        return {
          text: String(existing.text),
          sourceId: chapter.sourceDocumentId,
          hash: String(existing.text_hash ?? ""),
        };
      }
    }
    const text = await extractPdfPageRange(
      fs.readFileSync(bookPdfFile(db, book.id)),
      book.libraryFilename,
      chapter.pdfPageStart,
      end,
    );
    if (!usable(text, chapter.title)) return null;
    const saved = insertSource(db, {
      bookId: book.id,
      provenanceType: "uploaded",
      provenanceLabel: `PDF pages ${chapter.pdfPageStart}–${end}`,
      text,
      filename: book.libraryFilename,
      pageLocator: `PDF pages ${chapter.pdfPageStart}–${end}`,
      editionNote: note,
      aiConsentAt: new Date().toISOString(),
    });
    db.prepare(
      `UPDATE chapters SET source_document_id = ?, source_span_start = 0, source_span_end = ?, updated_at = ? WHERE id = ?`,
    ).run(saved.id, text.length, new Date().toISOString(), chapter.id);
    return { text, sourceId: saved.id, hash: saved.textHash };
  }
  const stored = chapterText(db, chapter);
  if (stored && chapter.sourceDocumentId && usable(stored, chapter.title)) {
    const source = getSource(db, chapter.sourceDocumentId);
    return { text: stored, sourceId: chapter.sourceDocumentId, hash: String(source.text_hash ?? "") };
  }
  if (book.catalogUrl && !book.libraryFilename) {
    try {
      const fetched = await fetchSectionFromSite(book.catalogUrl, chapter.title);
      if (!usable(fetched.text, chapter.title)) return null;
      const saved = saveWebExcerpt(db, chapter, fetched);
      return { text: saved.text, sourceId: saved.id, hash: saved.hash };
    } catch {
      return null;
    }
  }
  return null;
}

function usable(text: string, title: string): boolean {
  return isSubstantialChapter(text, title) && hasProse(text);
}
