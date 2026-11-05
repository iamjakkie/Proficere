import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  AppError,
  hasProse,
  isSubstantialChapter,
  milestoneChapterIds,
  FIXTURE_AUTHOR,
  FIXTURE_BOOK_TITLE,
  FIXTURE_SOURCE,
  OutlineChapterSchema,
  chooseImportedBook,
  enrichOutline,
  titleIsPlaceholder,
  assessmentLabel,
  assessmentLabelText,
  ProjectProposalSchema,
  validateVerificationPlan,
} from "@progress-island/shared";
import { aiConfigured, config } from "./config.js";
import { registerShelfRoutes } from "./shelf-routes.js";
import { activeCourse, islandMarkers } from "./shelf-store.js";
import { generateMilestoneExam, readingExamFailure, scheduleReadingFollowups } from "./reading-followup.js";
import type { Db } from "./db.js";
import { searchCatalog } from "./catalog.js";
import { extractChaptersFromPdf, extractPdfText, PDF_LIMITS } from "./pdf.js";
import {
  contentTypeForCover,
  coverFilePath,
  openLibraryCoverUrl,
  parseCoverUrl,
  saveRemoteCover,
  probeRemoteCover,
  removeCoverFiles,
  saveUploadedCover,
} from "./covers.js";
import {
  attachBookPdf,
  bookPdfFile,
  chapterTextFromLibrary,
  clearBookPdf,
  describeLibrary,
  importChaptersFromAttachedPdf,
  saveLibraryFolder,
  saveUploadedLibraryPdf,
} from "./library.js";
import {
  extractBookWithAi,
  extractOutlineWithAi,
  generateReviewPackWithAi,
  getAiStatus,
  testOpenRouterConnection,
} from "./openrouter.js";
import { fetchSectionFromSite } from "./site-chapter.js";
import { reviewAnswersWithAi, reviewSubmissionWithAi, suggestProjectsWithAi } from "./project-ai.js";
import { previewExam, reviewExam } from "./exam-review.js";
import {
  acceptProposal,
  addSubmission,
  approveProject,
  buildSuggestionContext,
  dismissProject,
  dismissSuggestion,
  findBatch,
  findReview,
  finishProject,
  getProject,
  getReview,
  getSubmission,
  latestBatch,
  listProjects,
  listSubmissions,
  listVersions,
  objectiveResultsFor,
  presentBatch,
  presentProject,
  presentVersion,
  projectOptions,
  reopenForRevision,
  resumeProject,
  saveAnswers,
  saveBatch,
  saveReview,
  updateDraft,
} from "./project-store.js";
import { fieldResources } from "./field.js";
import {
  addCategory,
  chapterText,
  buildMergePreview,
  confirmChapters,
  createBook,
  dashboardPlan,
  dismissLatestSource,
  dismissedSourceId,
  draftOutlineForBook,
  dueReviews,
  exportBackup,
  filterGroundedOutline,
  getBook,
  updateBookDetails,
  getChapter,
  getSource,
  insertSource,
  islandState,
  islandTrees,
  latestSourceForBook,
  listBooksForLibrary,
  listCategories,
  listChapters,
  localOrEmptyOutline,
  logActivity,
  markStalePacks,
  mergeBookIdentifiers,
  setBookPriority,
  nextSelectedChapter,
  nowIso,
  printQueue,
  recordReading,
  skipMilestoneExam,
  refreshPackStale,
  removeCategory,
  renameCategory,
  reorderBooks,
  restoreBackup,
  saveReviewPack,
  saveWebExcerpt,
  scoreAttempt,
  setBookCover,
  undoLastProgress,
  updateChapter,
  updateReviewItem,
} from "./store.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PDF_LIMITS.maxBytes },
});

const uploadBookPdf = multer({
  storage: multer.memoryStorage(),
});

function examsForBook(db: Db, bookId: string) {
  return listProjects(db)
    .filter((project) => project.status !== "dismissed")
    .flatMap((project) =>
      project.brief.sources
        .filter((source) => source.bookId === bookId && source.chapterId)
        .map((source) => ({
          chapterId: source.chapterId,
          projectId: project.id,
          title: project.brief.title,
          status: project.status,
          passed: project.passed,
        })),
    );
}

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next);
  };
}

function projectLabelText(label: string): string {
  if (
    label === "verified" ||
    label === "ai_reviewed" ||
    label === "needs_revision" ||
    label === "operational_failure" ||
    label === "unverified" ||
    label === "passed" ||
    label === "failed"
  ) {
    return assessmentLabelText(label);
  }
  return assessmentLabelText("unverified");
}

function gateWithFailure<T extends { chapterId: string }>(gate: T | null): (T & { failure: string | null }) | null {
  if (!gate) return null;
  return { ...gate, failure: readingExamFailure(gate.chapterId) };
}

async function importSelectedPdf(
  db: Db,
  file: { buffer: Buffer; originalname: string } | undefined,
  consentRaw: unknown,
  bookId?: string,
) {
  if (!file) throw new AppError("Choose a PDF file.", "missing_file", 400);
  const consent = consentRaw === true || String(consentRaw ?? "") === "true";
  requireConsent({ consent });
  if (!aiConfigured()) {
    throw new AppError(
      "Configure OpenRouter to read the title and chapters from a PDF. Set OPENROUTER_API_KEY and OPENROUTER_MODEL in your local .env file.",
      "missing_config",
      400,
    );
  }
  const extracted = await extractChaptersFromPdf(file.buffer, file.originalname);
  const readable = extracted.text.replace(/--- PDF page \d+ ---/g, "").trim();
  if (readable.length < 40 && extracted.outline.length < 2) {
    throw new AppError(
      "This PDF looks image-only or has no extractable text. OCR is not supported, so a scan cannot supply a title or chapter list.",
      "pdf_image_only",
      400,
    );
  }
  let ai: Awaited<ReturnType<typeof extractBookWithAi>> | null = null;
  let modelNote = "";
  if (readable.length >= 40) {
    try {
      ai = await extractBookWithAi(extracted.text);
    } catch (error) {
      if (extracted.outline.length < 2) throw error;
      modelNote = error instanceof Error ? error.message : "The model did not read this PDF.";
    }
  }
  const chosen = chooseImportedBook({
    filename: file.originalname,
    sourceText: extracted.text,
    localOutline: extracted.outline,
    ai,
  });
  const outline = enrichOutline(chosen.outline, extracted.text);
  const existing = bookId ? getBook(db, bookId) : null;
  const book = existing
    ? updateBookDetails(db, existing.id, {
        title: titleIsPlaceholder(existing.title, file.originalname) ? chosen.title : existing.title,
        author: existing.author ?? chosen.author,
      })
    : createBook(db, {
        title: chosen.title,
        author: chosen.author,
        contentsAvailable: outline.length > 0,
      });
  const provenanceLabel = ai
    ? `${extracted.provenanceLabel}. Title and chapters checked against the PDF text with OpenRouter.`
    : extracted.provenanceLabel;
  const source = insertSource(db, {
    bookId: book.id,
    provenanceType: "uploaded",
    provenanceLabel,
    text: extracted.text,
    filename: file.originalname,
    pageLocator: extracted.outline.some((chapter) => chapter.pdfPageStart != null)
      ? "PDF bookmark destinations"
      : `Opening pages of ${file.originalname}`,
    aiConsentAt: nowIso(),
    outline,
  });
  let savedName: string | null = null;
  let copyNote = "";
  try {
    savedName = saveUploadedLibraryPdf(db, book.id, file.originalname, file.buffer);
  } catch {
    copyNote = "The chapter preview is ready, but the PDF could not be copied into the library folder.";
  }
  const libraryNote = savedName
    ? `The PDF is attached as ${savedName}.`
    : copyNote || "Set a library folder and attach this PDF to read it.";
  const chapterNote =
    outline.length > 0
      ? "Review the chapter preview before saving."
      : "No chapter list was found in the PDF bookmarks or the opening pages. Nothing was invented. Add chapters in the preview.";
  const titleNote =
    !existing && chosen.titleFromFile
      ? "The title is the filename because the opening pages did not contain a title that could be checked."
      : "";
  return {
    book,
    sourceId: source.id,
    outline,
    provenanceLabel,
    needsConfirmation: true,
    message: [chapterNote, titleNote, libraryNote, modelNote].filter(Boolean).join(" "),
  };
}

function requireConsent(body: { consent?: boolean }): void {
  if (!body.consent) {
    throw new AppError(
      "AI requests send the supplied text to OpenRouter and then to the selected model provider. Confirm that you understand this before continuing. Local SQLite storage does not mean processing stays on this Mac.",
      "consent_required",
      400,
    );
  }
}

export function createApp(db: Db): Express {
  const app = express();
  app.use(
    cors({
      origin: [
        config.clientOrigin,
        `http://localhost:${process.env.CLIENT_PORT ?? "5173"}`,
        "http://127.0.0.1:5173",
        "http://localhost:5173",
      ],
    }),
  );
  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, name: "progress-island" });
  });

  app.get("/api/ai", (_req, res) => {
    res.json({
      ...getAiStatus(),
      notice:
        "Generative requests use OpenRouter with your server-side key. Uploaded or pasted text leaves this device when you opt in.",
    });
  });

  app.post(
    "/api/ai/test",
    asyncHandler(async (_req, res) => {
      if (!aiConfigured()) {
        throw new AppError(
          "Configure OpenRouter to enable AI. Add OPENROUTER_API_KEY and OPENROUTER_MODEL to .env.",
          "missing_config",
          400,
        );
      }
      const result = await testOpenRouterConnection();
      res.json(result);
    }),
  );

  app.get("/api/dashboard", (_req, res) => {
    const next = nextSelectedChapter(db);
    res.json({
      nextChapter: next?.chapter ?? null,
      nextBookTitle: next?.bookTitle ?? null,
      dueReviews: dueReviews(db),
      island: islandState(db),
      trees: islandTrees(db),
      categories: listCategories(db),
      planProgress: dashboardPlan(db),
      ai: getAiStatus(),
      markers: islandMarkers(db),
      activeCourse: activeCourse(db),
      field: fieldResources(db),
    });
  });

  app.get("/api/island", (_req, res) => {
    res.json({ island: islandState(db), rewards: undefined });
  });

  app.get("/api/library", (req, res) => {
    const match = String(req.query.match ?? "").trim();
    res.json(describeLibrary(db, match || undefined));
  });

  app.put(
    "/api/library",
    asyncHandler(async (req, res) => {
      const body = z.object({ path: z.string() }).parse(req.body);
      res.json(saveLibraryFolder(db, body.path));
    }),
  );

  app.put(
    "/api/books/:id/library",
    asyncHandler(async (req, res) => {
      const body = z.object({ filename: z.string().nullable() }).parse(req.body);
      if (!body.filename) {
        res.json({ book: clearBookPdf(db, req.params.id), outline: [], sourceId: null, message: null });
        return;
      }
      const book = attachBookPdf(db, req.params.id, body.filename);
      try {
        const imported = await importChaptersFromAttachedPdf(db, book.id);
        res.json({ book, ...imported });
      } catch (error) {
        res.json({
          book,
          outline: [],
          sourceId: null,
          message:
            error instanceof AppError
              ? error.message
              : "The PDF was attached, but chapters could not be read from it.",
        });
      }
    }),
  );

  app.post(
    "/api/books/:id/import/library",
    asyncHandler(async (req, res) => {
      const book = getBook(db, req.params.id);
      const imported = await importChaptersFromAttachedPdf(db, book.id);
      res.json({ book, ...imported, needsConfirmation: true });
    }),
  );

  app.get("/api/books", (_req, res) => {
    res.json({ books: listBooksForLibrary(db) });
  });

  app.get("/api/categories", (_req, res) => {
    res.json({ categories: listCategories(db) });
  });

  app.post(
    "/api/categories",
    asyncHandler(async (req, res) => {
      const body = z.object({ label: z.string() }).parse(req.body);
      res.status(201).json({ categories: addCategory(db, body.label) });
    }),
  );

  app.patch(
    "/api/categories/:id",
    asyncHandler(async (req, res) => {
      const body = z.object({ label: z.string() }).parse(req.body);
      res.json({ categories: renameCategory(db, req.params.id, body.label) });
    }),
  );

  app.delete(
    "/api/categories/:id",
    asyncHandler(async (req, res) => {
      res.json({ categories: removeCategory(db, req.params.id) });
    }),
  );

  app.put(
    "/api/books/:id/category",
    asyncHandler(async (req, res) => {
      const body = z.object({ category: z.string().min(1).max(40).nullable() }).parse(req.body);
      if (body.category && !listCategories(db).some((category) => category.id === body.category)) {
        throw new AppError("Unknown category.", "category", 400);
      }
      const book = mergeBookIdentifiers(db, req.params.id, { category: body.category });
      res.json({ book });
    }),
  );

  app.put(
    "/api/books/:id/priority",
    asyncHandler(async (req, res) => {
      const body = z.object({ priority: z.enum(["none", "high", "top"]) }).parse(req.body);
      res.json({ book: setBookPriority(db, req.params.id, body.priority) });
    }),
  );

  app.put(
    "/api/books/order",
    asyncHandler(async (req, res) => {
      const body = z.object({ ids: z.array(z.string().uuid()).min(1) }).parse(req.body);
      res.json({ books: reorderBooks(db, body.ids) });
    }),
  );

  app.post(
    "/api/books",
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          title: z.string().min(1),
          author: z.string().optional().nullable(),
          edition: z.string().optional().nullable(),
          isbn: z.string().optional().nullable(),
          catalogUrl: z.string().optional().nullable(),
          contentsAvailable: z.boolean().optional(),
        })
        .parse(req.body);
      const book = createBook(db, body);
      res.status(201).json({ book });
    }),
  );

  app.post(
    "/api/books/from-pdf",
    uploadBookPdf.single("file"),
    asyncHandler(async (req, res) => {
      const result = await importSelectedPdf(db, req.file, req.body?.consent);
      res.status(201).json(result);
    }),
  );

  app.post(
    "/api/books/:id/from-pdf",
    uploadBookPdf.single("file"),
    asyncHandler(async (req, res) => {
      const result = await importSelectedPdf(db, req.file, req.body?.consent, req.params.id);
      res.json(result);
    }),
  );

  app.post(
    "/api/books/fixture",
    asyncHandler(async (_req, res) => {
      const book = createBook(db, {
        title: FIXTURE_BOOK_TITLE,
        author: FIXTURE_AUTHOR,
        edition: "laboratory fixture",
        contentsAvailable: false,
      });
      res.status(201).json({ book, sourceText: FIXTURE_SOURCE });
    }),
  );

  app.get(
    "/api/books/:id",
    asyncHandler(async (req, res) => {
      const book = getBook(db, req.params.id);
      const source = latestSourceForBook(db, book.id);
      res.json({
        book,
        chapters: listChapters(db, book.id),
        source: source
          ? {
              id: source.id,
              provenanceLabel: source.provenance_label,
              provenanceType: source.provenance_type,
              filename: source.filename,
              textHash: source.text_hash,
            }
          : null,
        draftOutline: draftOutlineForBook(db, book.id),
        dismissedSourceId: dismissedSourceId(db, book.id),
        exams: examsForBook(db, book.id),
      });
    }),
  );

  app.put(
    "/api/books/:id/cover",
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          coverUrl: z.string().nullable().optional(),
          isbn: z.string().nullable().optional(),
        })
        .parse(req.body);
      const book = getBook(db, req.params.id);
      if (body.coverUrl === null && !body.isbn) {
        removeCoverFiles(book.id);
        res.json({ book: setBookCover(db, book.id, null, { coverFile: null }) });
        return;
      }
      const isbn = body.isbn?.trim() || book.isbn;
      const requested = body.coverUrl?.trim()
        ? body.coverUrl
        : isbn
          ? openLibraryCoverUrl(isbn)
          : null;
      if (!requested) {
        throw new AppError(
          "Paste an image URL, upload a file, or enter an ISBN to look up a cover.",
          "cover_url",
          400,
        );
      }
      const parsed = parseCoverUrl(requested);
      if (parsed.kind === "remote") {
        await probeRemoteCover(parsed.value);
        const saved = await saveRemoteCover(book.id, parsed.value);
        res.json({ book: setBookCover(db, book.id, saved.coverUrl, { coverFile: saved.coverFile }) });
        return;
      }
      res.json({
        book: setBookCover(db, book.id, parsed.value, {
          coverFile: book.identifiers.coverFile ?? null,
        }),
      });
    }),
  );

  app.post(
    "/api/books/:id/cover",
    upload.single("file"),
    asyncHandler(async (req, res) => {
      const book = getBook(db, req.params.id);
      if (!req.file) {
        throw new AppError("Choose an image file.", "cover_file", 400);
      }
      const saved = saveUploadedCover(book.id, req.file);
      res.json({ book: setBookCover(db, book.id, saved.coverUrl, { coverFile: saved.coverFile }) });
    }),
  );

  app.get("/api/books/:id/cover-image", (req, res, next) => {
    try {
      const book = getBook(db, req.params.id);
      const name = book.identifiers.coverFile;
      if (!name) {
        throw new AppError("This book has no uploaded cover.", "cover_file", 404);
      }
      const file = coverFilePath(name);
      if (!fs.existsSync(file)) {
        throw new AppError("This book has no uploaded cover.", "cover_file", 404);
      }
      res.setHeader("Content-Type", contentTypeForCover(name));
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(file, (err) => {
        if (!err || res.headersSent) return;
        next(err);
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/books/:id/pdf", (req, res, next) => {
    try {
      const file = bookPdfFile(db, req.params.id);
      const base = path.basename(file);
      res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(base)}`);
      res.sendFile(file, (err) => {
        if (!err || res.headersSent) return;
        next(err);
      });
    } catch (error) {
      next(error);
    }
  });

  app.post(
    "/api/books/:id/reading",
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          page: z.number().int().positive(),
          pageCount: z.number().int().positive(),
        })
        .parse(req.body);
      const result = recordReading(db, req.params.id, body.page, body.pageCount);
      scheduleReadingFollowups(db, result.followups);
      res.json({
        book: result.book,
        chapters: result.chapters,
        examLock: result.examLock,
        examGate: gateWithFailure(result.examGate),
        examNotice: result.examNotice,
      });
    }),
  );

  app.post(
    "/api/books/:id/reading/skip",
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          chapterId: z.string().uuid(),
          page: z.number().int().positive().optional(),
          pageCount: z.number().int().positive().optional(),
        })
        .parse(req.body);
      skipMilestoneExam(db, req.params.id, body.chapterId);
      if (body.page == null || body.pageCount == null) {
        res.json({ skipped: true });
        return;
      }
      const result = recordReading(db, req.params.id, body.page, body.pageCount);
      scheduleReadingFollowups(db, result.followups);
      res.json({
        skipped: true,
        book: result.book,
        chapters: result.chapters,
        examLock: result.examLock,
        examGate: gateWithFailure(result.examGate),
        examNotice: result.examNotice,
      });
    }),
  );

  app.post(
    "/api/books/:id/reading/exam",
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          page: z.number().int().positive(),
          pageCount: z.number().int().positive(),
          chapterId: z.string().uuid(),
        })
        .parse(req.body);
      const chapters = listChapters(db, req.params.id);
      const ids = milestoneChapterIds(chapters, body.chapterId);
      await generateMilestoneExam(db, ids.length > 0 ? ids : [body.chapterId]);
      const result = recordReading(db, req.params.id, body.page, body.pageCount);
      res.json({
        book: result.book,
        chapters: result.chapters,
        examLock: result.examLock,
        examGate: gateWithFailure(result.examGate),
        examNotice: result.examNotice,
      });
    }),
  );

  app.get(
    "/api/catalog/search",
    asyncHandler(async (req, res) => {
      const q = String(req.query.q ?? "").trim();
      if (q.length < 2) {
        throw new AppError("Enter a title, author, or ISBN.", "query", 400);
      }
      const hits = await searchCatalog(q);
      res.json({
        hits,
        note:
          "Catalog metadata is not a table of contents. Confirm the edition. If contents are unavailable, select the PDF.",
      });
    }),
  );

  app.post(
    "/api/books/:id/import/paste",
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          text: z.string().min(10),
          consent: z.boolean().optional(),
          useAi: z.boolean().optional(),
        })
        .parse(req.body);
      const book = getBook(db, req.params.id);
      const local = localOrEmptyOutline(body.text);
      let outline = local;
      let usedAi = false;
      if (body.useAi) {
        requireConsent(body);
        if (!aiConfigured()) {
          throw new AppError(
            "Configure OpenRouter to enable AI. Tracking still works; paste a numbered contents list for extraction without a model.",
            "missing_config",
            400,
          );
        }
        outline = filterGroundedOutline(await extractOutlineWithAi(body.text), body.text);
        usedAi = true;
      }
      outline = enrichOutline(outline.length ? outline : local, body.text);
      const provenanceLabel = usedAi
        ? "Extracted from pasted text (OpenRouter)"
        : "Extracted from pasted text";
      const source = insertSource(db, {
        bookId: book.id,
        provenanceType: "pasted",
        provenanceLabel,
        text: body.text,
        aiConsentAt: usedAi ? nowIso() : null,
        outline,
      });
      res.json({
        sourceId: source.id,
        outline,
        provenanceLabel,
        usedAi,
        needsConfirmation: true,
        message:
          outline.length === 0
            ? "No chapter headings were found. Add titles in the preview, or paste a numbered contents list. Nothing was invented."
            : "Review the chapter preview before saving.",
      });
    }),
  );

  app.post(
    "/api/books/:id/import/pdf",
    upload.single("file"),
    asyncHandler(async (req, res) => {
      const book = getBook(db, req.params.id);
      if (!req.file) {
        throw new AppError("Choose a PDF file.", "missing_file", 400);
      }
      const consent = String(req.body.consent ?? "") === "true";
      const useAi = String(req.body.useAi ?? "") === "true";
      const extracted = await extractPdfText(req.file.buffer, req.file.originalname);
      const local = localOrEmptyOutline(extracted.text);
      let outline = local;
      let usedAi = false;
      if (useAi) {
        requireConsent({ consent });
        if (!aiConfigured()) {
          throw new AppError(
            "Configure OpenRouter to enable AI. A numbered contents page can still be parsed without a model.",
            "missing_config",
            400,
          );
        }
        outline = filterGroundedOutline(
          await extractOutlineWithAi(extracted.text),
          extracted.text,
        );
        usedAi = true;
      }
      outline = enrichOutline(outline.length ? outline : local, extracted.text);
      const provenanceLabel = `Extracted from uploaded document ${req.file.originalname} (PDF pages 1–${extracted.pages})`;
      const source = insertSource(db, {
        bookId: book.id,
        provenanceType: "uploaded",
        provenanceLabel,
        text: extracted.text,
        filename: req.file.originalname,
        pageLocator: `PDF pages 1–${extracted.pages}`,
        aiConsentAt: usedAi ? nowIso() : null,
        outline,
      });
      res.json({
        sourceId: source.id,
        outline,
        provenanceLabel,
        usedAi,
        pages: extracted.pages,
        needsConfirmation: true,
      });
    }),
  );

  app.post(
    "/api/books/:id/import/retrieved",
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          outline: z.array(OutlineChapterSchema),
          url: z.string(),
          edition: z.string().nullable().optional(),
        })
        .parse(req.body);
      const book = getBook(db, req.params.id);
      const text = body.outline
        .map((c) => `${c.number ?? ""} ${c.title}`.trim())
        .join("\n");
      const source = insertSource(db, {
        bookId: book.id,
        provenanceType: "retrieved",
        provenanceLabel: `Retrieved contents, ${body.url}${body.edition ? `, edition: ${body.edition}` : ""}`,
        text,
        url: body.url,
        editionNote: body.edition ?? null,
        outline: body.outline,
      });
      res.json({ sourceId: source.id, outline: body.outline });
    }),
  );

  app.post(
    "/api/books/:id/chapters/confirm",
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          sourceId: z.string().uuid().nullable().optional(),
          outline: z.array(OutlineChapterSchema),
          merge: z.boolean().optional(),
          dryRun: z.boolean().optional(),
        })
        .parse(req.body);
      if (body.dryRun) {
        const existing = listChapters(db, req.params.id);
        res.json({
          dryRun: true,
          mergePreview: buildMergePreview(existing, body.outline),
          chapters: existing,
        });
        return;
      }
      const result = confirmChapters(
        db,
        req.params.id,
        body.sourceId ?? null,
        body.outline,
        Boolean(body.merge),
      );
      res.json(result);
    }),
  );

  app.patch(
    "/api/chapters/:id",
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          selected: z.boolean().optional(),
          printed: z.boolean().optional(),
          progressPercent: z.number().min(0).max(100).optional(),
          note: z.string().max(500).nullable().optional(),
          pagePosition: z.string().max(80).nullable().optional(),
        })
        .parse(req.body);
      const chapter = updateChapter(db, req.params.id, body);
      res.json({ chapter, island: islandState(db) });
    }),
  );

  app.post(
    "/api/chapters/:id/complete",
    asyncHandler(async (req, res) => {
      const chapter = updateChapter(db, req.params.id, { progressPercent: 100 });
      res.json({ chapter, island: islandState(db) });
    }),
  );

  app.post(
    "/api/chapters/:id/undo",
    asyncHandler(async (req, res) => {
      const chapter = undoLastProgress(db, req.params.id);
      res.json({ chapter, island: islandState(db) });
    }),
  );

  app.get("/api/print-queue", (_req, res) => {
    res.json({
      items: printQueue(db),
      notice:
        "This is a checklist of chapters you marked printed. Proficere does not extract or print book pages.",
    });
  });

  app.post(
    "/api/books/:id/import/dismiss",
    asyncHandler(async (req, res) => {
      getBook(db, req.params.id);
      dismissLatestSource(db, req.params.id);
      res.json({ ok: true });
    }),
  );

  app.post(
    "/api/chapters/:id/library-excerpt",
    asyncHandler(async (req, res) => {
      const chapter = getChapter(db, req.params.id);
      const saved = await chapterTextFromLibrary(db, chapter);
      if (!saved) {
        throw new AppError(
          "Attach a PDF from your library folder before reading a chapter from it.",
          "library_file",
          400,
        );
      }
      const updated = getChapter(db, chapter.id);
      res.json({
        characters: saved.text.length,
        pdfPageStart: updated.pdfPageStart,
        pdfPageEnd: updated.pdfPageEnd,
        preview: saved.text.replace(/--- PDF page \d+ ---/g, " ").replace(/\s+/g, " ").trim().slice(0, 480),
      });
    }),
  );

  app.post(
    "/api/chapters/:id/reviews/generate",
    asyncHandler(async (req, res) => {
      const body = z.object({ consent: z.boolean().optional() }).parse(req.body ?? {});
      requireConsent(body);
      if (!aiConfigured()) {
        throw new AppError(
          "Configure OpenRouter to enable AI. Your progress is unchanged.",
          "missing_config",
          400,
        );
      }
      const chapter = getChapter(db, req.params.id);
      const book = getBook(db, chapter.bookId);
      let text = chapterText(db, chapter);
      let sourceId = chapter.sourceDocumentId;
      if (book.libraryFilename) {
        try {
          const fromLibrary = await chapterTextFromLibrary(db, chapter);
          if (fromLibrary) {
            text = fromLibrary.text;
            sourceId = fromLibrary.id;
          }
        } catch (error) {
          if (!text || !isSubstantialChapter(text, chapter.title)) throw error;
        }
      }
      if (!text || !isSubstantialChapter(text, chapter.title)) {
        throw new AppError(
          book.libraryFilename
            ? "The attached PDF did not yield this chapter’s body text. Check the chapter title against the PDF, or paste the chapter."
            : "This chapter has no supplied body text. Attach the book PDF from your library folder, or paste the chapter. A title is not enough.",
          "missing_source",
          400,
        );
      }
      if (!hasProse(text)) {
        if (book.catalogUrl && !book.libraryFilename) {
          const fetched = await fetchSectionFromSite(book.catalogUrl, chapter.title);
          const saved = saveWebExcerpt(db, chapter, fetched);
          text = saved.text;
          sourceId = saved.id;
        } else {
          throw new AppError(
            "This chapter only has a heading list, not the section text. Paste the chapter or attach the PDF before generating a review.",
            "missing_source",
            400,
          );
        }
      }
      if (!sourceId) {
        throw new AppError(
          "Attach a source document before generating a review.",
          "missing_source",
          400,
        );
      }
      const source = getSource(db, sourceId);
      const hash = String(source.text_hash ?? "");
      markStalePacks(db, chapter.id, hash);
      const generated = await generateReviewPackWithAi({
        chapterTitle: chapter.title,
        chapterText: text,
      });
      const pack = saveReviewPack(db, {
        chapterId: chapter.id,
        sourceDocumentId: sourceId,
        sourceHash: hash,
        flashcards: generated.flashcards,
        questions: generated.questions,
      });
      res.json({ pack });
    }),
  );

  app.get(
    "/api/chapters/:id/reviews",
    asyncHandler(async (req, res) => {
      const chapter = getChapter(db, req.params.id);
      const book = getBook(db, chapter.bookId);
      const text = chapterText(db, chapter);
      const prose = Boolean(text && hasProse(text));
      res.json({
        pack: refreshPackStale(db, req.params.id),
        bookId: book.id,
        libraryFilename: book.libraryFilename,
        pdfPageStart: chapter.pdfPageStart,
        hasChapterBody: prose,
        willReadSite: Boolean(!prose && book.catalogUrl && !book.libraryFilename),
      });
    }),
  );

  app.patch(
    "/api/reviews/:packId/items",
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          kind: z.enum(["flashcard", "question"]),
          id: z.string().min(1),
          action: z.enum(["edit", "reject", "restore", "report"]),
          front: z.string().optional(),
          back: z.string().optional(),
          prompt: z.string().optional(),
          reportNote: z.string().max(500).nullable().optional(),
        })
        .parse(req.body);
      const pack = updateReviewItem(db, req.params.packId, body);
      res.json({ pack });
    }),
  );

  app.post(
    "/api/reviews/:packId/attempt",
    asyncHandler(async (req, res) => {
      const body = z.object({ answers: z.record(z.string()) }).parse(req.body);
      const result = scoreAttempt(db, req.params.packId, body.answers);
      res.json({ ...result, island: islandState(db) });
    }),
  );

  app.get("/api/projects/options", (_req, res) => {
    const batch = latestBatch(db);
    res.json({
      books: projectOptions(db),
      projects: listProjects(db).map(presentProject),
      batch: batch ? presentBatch(batch) : null,
    });
  });

  app.get(
    "/api/projects/:id",
    asyncHandler(async (req, res) => {
      const project = getProject(db, req.params.id);
      const submissions = listSubmissions(db, project.id);
      res.json({
        project: presentProject(project),
        versions: listVersions(db, project.id).map(presentVersion),
        submissions,
        reviews: submissions.map((submission) => findReview(db, submission.id)).filter(Boolean),
        plan: validateVerificationPlan(project.brief.criteria),
      });
    }),
  );

  app.post(
    "/api/projects/suggestions",
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          consent: z.boolean().optional(),
          chapterIds: z.array(z.string().uuid()).min(1).max(6),
          goal: z.string().max(300).optional(),
          hours: z.number().positive().max(40).nullable().optional(),
          output: z.string().max(200).optional(),
          tools: z.string().max(200).optional(),
          instruction: z.string().max(500).optional(),
          refresh: z.boolean().optional(),
        })
        .parse(req.body ?? {});
      requireConsent(body);
      if (!aiConfigured()) {
        throw new AppError("Configure OpenRouter to enable AI. Your progress is unchanged.", "missing_config", 400);
      }
      const topics: Record<string, { heading: string; equations: string[] }[]> = {};
      for (const chapterId of body.chapterIds) {
        const chapter = getChapter(db, chapterId);
        const book = getBook(db, chapter.bookId);
        const stored = chapterText(db, chapter) ?? "";
        if (book.catalogUrl && !book.libraryFilename) {
          const fetched = await fetchSectionFromSite(book.catalogUrl, chapter.title);
          if (!hasProse(stored)) saveWebExcerpt(db, chapter, fetched);
          topics[chapterId] = fetched.topics;
        }
      }
      const context = buildSuggestionContext(db, {
        chapterIds: body.chapterIds,
        goal: body.goal ?? "",
        hours: body.hours ?? null,
        output: body.output ?? "",
        tools: body.tools ?? "",
        instruction: body.instruction ?? "",
        topics,
      });
      if (!body.refresh) {
        const existing = findBatch(db, context.hash);
        if (existing) {
          res.json({ batch: presentBatch(existing), reused: true });
          return;
        }
      }
      let proposals;
      try {
        proposals = await suggestProjectsWithAi(context.packet, context.corpus);
      } catch (error) {
        if (error instanceof AppError) throw error;
        const message = error instanceof Error ? error.message : "";
        throw new AppError(
          message.startsWith("The model did not")
            ? message
            : "The model did not return a usable project suggestion. Nothing was started.",
          "validation",
          502,
        );
      }
      const batch = saveBatch(
        db,
        context.hash,
        {
          chapterIds: body.chapterIds,
          goal: body.goal ?? "",
          hours: body.hours ?? null,
          output: body.output ?? "",
          tools: body.tools ?? "",
          instruction: body.instruction ?? "",
        },
        proposals,
      );
      res.json({ batch: presentBatch(batch), reused: false });
    }),
  );

  app.post(
    "/api/projects/dismiss-suggestion",
    asyncHandler(async (req, res) => {
      const body = z.object({ title: z.string().min(1), reason: z.string().min(3).max(500) }).parse(req.body);
      dismissSuggestion(db, body.title, body.reason);
      res.json({ ok: true });
    }),
  );

  app.post(
    "/api/projects",
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          batchId: z.string().uuid(),
          proposalId: z.string().min(1),
        })
        .parse(req.body);
      const project = acceptProposal(db, body.batchId, body.proposalId);
      res.status(201).json({ project: presentProject(project), plan: validateVerificationPlan(project.brief.criteria) });
    }),
  );

  app.patch(
    "/api/projects/:id",
    asyncHandler(async (req, res) => {
      const body = z.object({ brief: ProjectProposalSchema }).parse(req.body);
      const project = updateDraft(db, req.params.id, body.brief);
      res.json({ project: presentProject(project), plan: validateVerificationPlan(project.brief.criteria) });
    }),
  );

  app.post(
    "/api/projects/:id/dismiss",
    asyncHandler(async (req, res) => {
      const body = z.object({ reason: z.string().min(3).max(500) }).parse(req.body);
      res.json({ project: presentProject(dismissProject(db, req.params.id, body.reason)) });
    }),
  );

  app.post(
    "/api/projects/:id/resume",
    asyncHandler(async (req, res) => {
      res.json({ project: presentProject(resumeProject(db, req.params.id)) });
    }),
  );

  app.post(
    "/api/projects/:id/revise",
    asyncHandler(async (req, res) => {
      res.json({ project: presentProject(reopenForRevision(db, req.params.id)) });
    }),
  );

  app.post(
    "/api/projects/:id/approve",
    asyncHandler(async (req, res) => {
      const body = z.object({ assessmentMode: z.enum(["objective", "ai_reviewed"]) }).parse(req.body);
      const version = approveProject(db, req.params.id, body.assessmentMode);
      res.json({ version: presentVersion(version), project: presentProject(getProject(db, req.params.id)) });
    }),
  );

  app.post(
    "/api/projects/:id/run",
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          deliverable: z.string().max(20_000),
          exercise: z.number().int().nonnegative().optional(),
        })
        .parse(req.body ?? {});
      const project = getProject(db, req.params.id);
      if (project.status !== "active") {
        throw new AppError("Open an active project before running a derivation.", "invalid_state", 409);
      }
      if (!project.brief.exam) {
        throw new AppError("This project has no derivation to run.", "invalid_state", 409);
      }
      if (body.exercise != null && !project.brief.exam.exercises?.[body.exercise]) {
        throw new AppError("That task is not part of this exam.", "validation", 400);
      }
      res.json(await previewExam(project.brief, body.deliverable, body.exercise));
    }),
  );

  app.post(
    "/api/projects/:id/submissions",
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          explanation: z.string().max(8000),
          assumptions: z.string().max(4000),
          deliverable: z.string().max(20000),
          prediction: z.string().max(2000).nullable().optional(),
          tasks: z
            .array(
              z.object({
                index: z.number().int().nonnegative(),
                answer: z.string().max(8000),
                action: z.string().max(80).optional(),
              }),
            )
            .max(10)
            .optional(),
        })
        .parse(req.body);
      const submission = addSubmission(db, req.params.id, {
        explanation: body.explanation,
        assumptions: body.assumptions,
        deliverable: body.deliverable,
        prediction: body.prediction ?? null,
        tasks: body.tasks,
      });
      res.status(201).json({ submission });
    }),
  );

  app.post(
    "/api/projects/:id/submissions/:submissionId/verify",
    asyncHandler(async (req, res) => {
      const body = z.object({ consent: z.boolean().optional() }).parse(req.body ?? {});
      const submission = getSubmission(db, req.params.submissionId);
      if (submission.projectId !== req.params.id) {
        throw new AppError("Submission not found.", "not_found", 404);
      }
      const existing = findReview(db, submission.id);
      if (existing && existing.label !== "operational_failure") {
        res.json({ review: existing, labelText: projectLabelText(existing.label), reused: true });
        return;
      }
      const version = listVersions(db, submission.projectId).find((item) => item.id === submission.versionId);
      if (!version) {
        throw new AppError("This submission is missing its frozen brief version.", "version_mismatch", 409);
      }
      if (version.brief.exam) {
        const exercises = version.brief.exam.exercises ?? [];
        const workbook = exercises.length >= 3;
        const needsModel = !workbook || exercises.some((item) => item.kind === "theory");
        if (needsModel) requireConsent(body);
        const graded = await reviewExam({
          brief: version.brief,
          deliverable: submission.artifacts.deliverable,
          tasks: submission.artifacts.tasks,
          gradeWithModel: aiConfigured() && needsModel,
        });
        const review = saveReview(db, {
          submissionId: submission.id,
          versionId: version.id,
          objective: graded.objective,
          reasoning: graded.reasoning,
          questions: graded.questions,
          label: graded.label,
          nextAction: graded.nextAction,
          operational: graded.operational,
          grade: graded.grade,
          passed: graded.passed,
          notes: graded.notes,
        });
        res.json({ review, labelText: projectLabelText(review.label) });
        return;
      }
      requireConsent(body);
      const objective = objectiveResultsFor(version, submission.artifacts);
      const runnerFailed = objective.some((item) => item.operational);
      if (!aiConfigured()) {
        const review = saveReview(db, {
          submissionId: submission.id,
          versionId: version.id,
          objective,
          reasoning: [],
          questions: [],
          label: "operational_failure",
          nextAction: "Configure OpenRouter, then run the review again. The objective rows above are unchanged.",
          operational: { message: "The reasoning review did not run because OpenRouter is not configured." },
        });
        res.json({ review, labelText: projectLabelText("operational_failure") });
        return;
      }
      try {
        const reviewed = await reviewSubmissionWithAi({
          brief: version.brief,
          objective,
          submission: submission.artifacts,
        });
        const label = assessmentLabel({
          assessmentMode: version.assessmentMode,
          objective,
          reasoning: reviewed.reasoning,
          operational: runnerFailed,
        });
        const nextAction =
          reviewed.questions.length < 2
            ? "The reasoning review did not include enough questions about this submission. Run the review again before treating it as complete."
            : reviewed.nextAction;
        const review = saveReview(db, {
          submissionId: submission.id,
          versionId: version.id,
          objective,
          reasoning: reviewed.reasoning,
          questions: reviewed.questions,
          label,
          nextAction,
          operational: runnerFailed
            ? { message: "A checker could not run. That is not evidence the solution is wrong." }
            : null,
        });
        res.json({ review, labelText: projectLabelText(label) });
      } catch (error) {
        const message = error instanceof AppError ? error.message : "The reasoning review did not finish.";
        const review = saveReview(db, {
          submissionId: submission.id,
          versionId: version.id,
          objective,
          reasoning: [],
          questions: [],
          label: "operational_failure",
          nextAction: "Run the review again. This failure does not mean the submission is wrong.",
          operational: { message },
        });
        res.json({ review, labelText: projectLabelText("operational_failure") });
      }
    }),
  );

  app.post(
    "/api/projects/:id/reviews/:reviewId/answers",
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          consent: z.boolean().optional(),
          answers: z.record(z.string().max(2000)),
        })
        .parse(req.body);
      requireConsent(body);
      const review = getReview(db, req.params.reviewId);
      const submission = getSubmission(db, review.submissionId);
      if (submission.projectId !== req.params.id) throw new AppError("Review not found.", "not_found", 404);
      if (!aiConfigured()) {
        throw new AppError("Configure OpenRouter to review answers. Objective results stay as they are.", "missing_config", 400);
      }
      const answerReview = await reviewAnswersWithAi({
        questions: review.questions,
        answers: body.answers,
        submission: submission.artifacts,
      });
      const saved = saveAnswers(db, review.id, body.answers, answerReview);
      res.json({ review: saved });
    }),
  );

  app.post(
    "/api/projects/:id/finish",
    asyncHandler(async (req, res) => {
      res.json({ project: presentProject(finishProject(db, req.params.id)) });
    }),
  );

  registerShelfRoutes(app, db);

  app.get("/api/backup", (_req, res) => {
    res.json(exportBackup(db));
  });

  app.post(
    "/api/backup/restore",
    asyncHandler(async (req, res) => {
      restoreBackup(db, req.body);
      logActivity(db, "backup_restored", {});
      res.json({ ok: true, island: islandState(db) });
    }),
  );

  app.use(express.static(path.join(config.root, "client", "dist")));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(config.root, "client", "dist", "index.html"), (err) => {
      if (err) next();
    });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
      return;
    }
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      res.status(400).json({
        error: "That file is larger than the upload limit.",
        code: "pdf_too_large",
      });
      return;
    }
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request.", code: "validation", details: err.flatten() });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Unexpected server error.", code: "internal" });
  });

  return app;
}
