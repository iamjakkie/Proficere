import fs from "node:fs";
import path from "node:path";
import { AppError, type OutlineChapter } from "@progress-island/shared";
import { config } from "./config.js";
import { extractChapterFromPdf, extractChaptersFromPdf } from "./pdf.js";
import type { Chapter } from "@progress-island/shared";
import type { Db } from "./db.js";
import {
  attachLibraryFilename,
  deleteSetting,
  getBook,
  getSetting,
  insertSource,
  listChapters,
  reuseLibraryExcerpt,
  saveLibraryExcerpt,
  setSetting,
} from "./store.js";

const SETTING_KEY = "library_path";

export type LibraryFile = { name: string; size: number };

export function libraryRoot(db: Db): string | null {
  const configured = getSetting(db, SETTING_KEY) || config.libraryPath;
  if (!configured) return null;
  return path.resolve(configured);
}

export function describeLibrary(db: Db, matchTitle?: string): {
  configured: boolean;
  path: string | null;
  error: string | null;
  files: LibraryFile[];
  suggested: LibraryFile[];
} {
  const root = libraryRoot(db);
  if (!root) {
    return {
      configured: false,
      path: null,
      error: null,
      files: [],
      suggested: [],
    };
  }
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return {
      configured: true,
      path: root,
      error: "That folder does not exist or is not a directory.",
      files: [],
      suggested: [],
    };
  }
  const files = listPdfFiles(root);
  return {
    configured: true,
    path: root,
    error: null,
    files: files.slice(0, 2000),
    suggested: matchTitle ? rankLibraryFiles(files, matchTitle).slice(0, 8) : [],
  };
}

export function saveLibraryFolder(db: Db, folder: string): ReturnType<typeof describeLibrary> {
  const trimmed = folder.trim();
  if (!trimmed) {
    deleteSetting(db, SETTING_KEY);
    return describeLibrary(db);
  }
  const resolved = path.resolve(trimmed);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new AppError(
      "Choose a folder that exists on this Mac. Progress Island only reads PDF files inside it.",
      "library_path",
      400,
    );
  }
  setSetting(db, SETTING_KEY, resolved);
  return describeLibrary(db);
}

export function attachBookPdf(db: Db, bookId: string, filename: string) {
  const root = requireRoot(db);
  resolveInsideLibrary(root, filename);
  return attachLibraryFilename(db, bookId, filename);
}

export function clearBookPdf(db: Db, bookId: string) {
  getBook(db, bookId);
  return attachLibraryFilename(db, bookId, null);
}

export async function importChaptersFromAttachedPdf(
  db: Db,
  bookId: string,
): Promise<{
  outline: OutlineChapter[];
  sourceId: string | null;
  provenanceLabel: string;
  message: string;
}> {
  const book = getBook(db, bookId);
  if (!book.libraryFilename) {
    throw new AppError(
      "Attach a PDF from your library folder before reading chapters from it.",
      "library_file",
      400,
    );
  }
  const absolute = bookPdfFile(db, bookId);
  const extracted = await extractChaptersFromPdf(fs.readFileSync(absolute), book.libraryFilename);
  if (!extracted.outline.length) {
    return {
      outline: [],
      sourceId: null,
      provenanceLabel: extracted.provenanceLabel,
      message:
        "This PDF has no bookmark chapter list, and the opening pages did not contain numbered headings. Add chapters manually, or paste a contents list. Nothing was invented.",
    };
  }
  const source = insertSource(db, {
    bookId,
    provenanceType: "uploaded",
    provenanceLabel: extracted.provenanceLabel,
    text: extracted.text,
    filename: book.libraryFilename,
    pageLocator: extracted.outline.some((chapter) => chapter.pdfPageStart != null)
      ? "PDF bookmark destinations"
      : `Opening pages of ${book.libraryFilename}`,
    outline: extracted.outline,
  });
  return {
    outline: extracted.outline,
    sourceId: source.id,
    provenanceLabel: extracted.provenanceLabel,
    message: "Review the chapter preview from this PDF before saving.",
  };
}

export function bookPdfFile(db: Db, bookId: string): string {
  const book = getBook(db, bookId);
  if (!book.libraryFilename) {
    throw new AppError(
      "Attach a PDF from your library folder before opening it.",
      "library_file",
      404,
    );
  }
  return resolveInsideLibrary(requireRoot(db), book.libraryFilename);
}

export async function chapterTextFromLibrary(
  db: Db,
  chapter: Chapter,
): Promise<{ id: string; text: string; hash: string } | null> {
  const book = getBook(db, chapter.bookId);
  if (!book.libraryFilename) return null;
  const root = requireRoot(db);
  const absolute = resolveInsideLibrary(root, book.libraryFilename);
  const stat = fs.statSync(absolute);
  const reused = reuseLibraryExcerpt(db, chapter, book.libraryFilename, stat.mtimeMs);
  if (reused) return reused;
  const nextTitles = nextChapterTitles(db, chapter);
  const extracted = await extractChapterFromPdf(fs.readFileSync(absolute), book.libraryFilename, {
    title: chapter.title,
    nextTitles,
  });
  return saveLibraryExcerpt(db, chapter, {
    filename: book.libraryFilename,
    text: extracted.text,
    mtimeMs: stat.mtimeMs,
    pdfPageStart: extracted.pdfPageStart,
    pdfPageEnd: extracted.pdfPageEnd,
  });
}

function nextChapterTitles(db: Db, chapter: Chapter): string[] {
  const chapters = listChapters(db, chapter.bookId);
  const index = chapters.findIndex((item) => item.id === chapter.id);
  if (index < 0) return [];
  return chapters
    .slice(index + 1, index + 3)
    .map((item) => item.title)
    .filter((title) => title.trim().length > 0);
}

function requireRoot(db: Db): string {
  const described = describeLibrary(db);
  if (!described.configured || !described.path) {
    throw new AppError(
      "Set a PDF library folder in Settings, or LIBRARY_PATH in .env, before attaching a book.",
      "library_unconfigured",
      400,
    );
  }
  if (described.error || !described.path) {
    throw new AppError(described.error ?? "PDF library folder is unavailable.", "library_path", 400);
  }
  return described.path;
}

export function resolveInsideLibrary(root: string, relativeName: string): string {
  const trimmed = relativeName.trim();
  if (!trimmed || trimmed.includes("\0")) {
    throw new AppError("Choose a PDF from the library folder.", "library_file", 400);
  }
  const rootReal = fs.realpathSync(root);
  const target = path.resolve(rootReal, trimmed);
  const relative = path.relative(rootReal, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new AppError("That file is outside the PDF library folder.", "library_file", 400);
  }
  if (path.extname(target).toLowerCase() !== ".pdf") {
    throw new AppError("Only PDF files from the library folder can be attached.", "library_file", 400);
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw new AppError(`Could not find ${trimmed} in the PDF library folder.`, "library_file", 404);
  }
  const fileReal = fs.realpathSync(target);
  const stillInside = path.relative(rootReal, fileReal);
  if (stillInside.startsWith("..") || path.isAbsolute(stillInside)) {
    throw new AppError("That file is outside the PDF library folder.", "library_file", 400);
  }
  return fileReal;
}

function listPdfFiles(root: string): LibraryFile[] {
  const files: LibraryFile[] = [];
  walk(root, root, files);
  files.sort((a, b) => a.name.localeCompare(b.name));
  return files;
}

function walk(dir: string, root: string, files: LibraryFile[]): void {
  if (files.length >= 2000) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (files.length >= 2000) return;
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, root, files);
      continue;
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".pdf")) continue;
    const name = path.relative(root, full).split(path.sep).join("/");
    files.push({ name, size: fs.statSync(full).size });
  }
}

export function libraryPdfFiles(db: Db): LibraryFile[] {
  const root = libraryRoot(db);
  if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) return [];
  return listPdfFiles(root);
}

/** Rank PDFs whose filename title is the book, not merely a shared word. */
export function rankLibraryFiles(files: LibraryFile[], title: string): LibraryFile[] {
  const book = compactTitle(title);
  if (book.length < 12) return [];
  return files
    .map((file) => ({ file, rank: titleRank(file.name, book) }))
    .filter((item) => item.rank > 0)
    .sort((a, b) => b.rank - a.rank || a.file.name.localeCompare(b.file.name))
    .map((item) => item.file);
}

function fileTitle(name: string): string {
  const base = name.split("/").pop() ?? name;
  return base.split(" -- ")[0].replace(/\.pdf$/i, "");
}

function compactTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bal\b/g, "ai")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(?!\w*(?:ous|ss|is|us)\b)(\w{5,})s\b/g, "$1")
    .replace(/\s+/g, "");
}

function titleRank(filename: string, book: string): number {
  const file = compactTitle(fileTitle(filename));
  if (file.length < 12 || book.length < 12) return 0;
  if (file.startsWith(book)) return 1000 - Math.min(file.length - book.length, 900);
  if (book.startsWith(file) && file.length >= 18 && file.length >= book.length * 0.42) {
    return 700 - Math.min(book.length - file.length, 600);
  }
  return 0;
}
