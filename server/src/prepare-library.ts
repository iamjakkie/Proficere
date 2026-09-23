import fs from "node:fs";
import { openDatabase } from "./db.js";
import {
  attachBookPdf,
  libraryPdfFiles,
  rankLibraryFiles,
  resolveInsideLibrary,
  saveLibraryFolder,
} from "./library.js";
import { openLibraryCoverUrl, probeRemoteCover } from "./covers.js";
import { extractChaptersFromPdf } from "./pdf.js";
import { insertSource, listBooks, mergeBookIdentifiers } from "./store.js";

const folder = process.argv[2];
if (!folder) {
  console.error("Usage: tsx src/prepare-library.ts <pdf-folder>");
  process.exit(1);
}

const db = openDatabase();
saveLibraryFolder(db, folder);
const files = libraryPdfFiles(db);
const books = listBooks(db).filter((book) => book.author !== "Progress Island Fixtures");

let attached = 0;
let covers = 0;
let previews = 0;
const missing: string[] = [];

for (const book of books) {
  const match = book.libraryFilename ? null : rankLibraryFiles(files, book.title)[0];
  const filename = book.libraryFilename ?? match?.name ?? null;
  if (!book.libraryFilename && match) {
    attachBookPdf(db, book.id, match.name);
    attached += 1;
  }
  const fileIsbn = filename?.match(/97[89]\d{10}/)?.[0] ?? null;
  const coverUrl = book.identifiers.coverUrl ? null : await coverFor(fileIsbn ?? book.isbn);
  const extra: Record<string, string> = {};
  if (coverUrl) {
    extra.coverUrl = coverUrl;
    covers += 1;
  }
  if (fileIsbn) extra.fileIsbn = fileIsbn;

  if (!filename) missing.push(book.title);

  if (filename && !book.identifiers.previewChapters) {
    try {
      const extracted = await extractChaptersFromPdf(
        fs.readFileSync(resolveInsideLibrary(folder, filename)),
        filename,
      );
      if (extracted.outline.length) {
        insertSource(db, {
          bookId: book.id,
          provenanceType: "uploaded",
          provenanceLabel: extracted.provenanceLabel,
          text: extracted.text,
          filename,
          outline: extracted.outline,
        });
        extra.previewChapters = String(extracted.outline.length);
        previews += 1;
        console.log(`preview ${extracted.outline.length}\t${book.title}`);
      } else {
        console.log(`no contents\t${book.title}`);
      }
    } catch (error) {
      console.log(`skip\t${filename}\t${error instanceof Error ? error.message : "unreadable"}`);
    }
  }
  if (Object.keys(extra).length) mergeBookIdentifiers(db, book.id, extra);
}

console.log(
  JSON.stringify(
    {
      books: books.length,
      pdfs: files.length,
      attached,
      covers,
      previews,
      missing,
    },
    null,
    2,
  ),
);

async function coverFor(isbn: string | null): Promise<string | null> {
  if (!isbn) return null;
  try {
    return await probeRemoteCover(openLibraryCoverUrl(isbn));
  } catch {
    return null;
  }
}
