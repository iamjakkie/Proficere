import fs from "node:fs";
import path from "node:path";
import { openDatabase } from "./db.js";
import { createBook, listBooks } from "./store.js";

type SeedBook = {
  query: string;
  title: string;
  author: string | null;
  edition: string | null;
  year: string | null;
  isbn: string | null;
};

const seedPath = path.resolve(import.meta.dirname, "initial-library.json");
const seed = JSON.parse(fs.readFileSync(seedPath, "utf8")) as SeedBook[];

function normalize(title: string): string {
  return title.trim().toLowerCase().replace(/[:.,]/g, "").replace(/\s+/g, " ");
}

const db = openDatabase();
const existing = new Set(listBooks(db).map((book) => normalize(book.title)));
let created = 0;
let skipped = 0;

for (const book of seed) {
  if (existing.has(normalize(book.title))) {
    skipped += 1;
    continue;
  }
  const identifiers: Record<string, string> = { seedQuery: book.query };
  if (book.year) identifiers.year = book.year;
  createBook(db, {
    title: book.title,
    author: book.author,
    edition: book.edition,
    isbn: book.isbn,
    contentsAvailable: false,
    identifiers,
  });
  existing.add(normalize(book.title));
  created += 1;
}

console.log(`Seeded ${created} books (${skipped} already present, ${seed.length} in catalog).`);
