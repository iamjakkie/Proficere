import fs from "node:fs";
import path from "node:path";
import { AppError } from "@progress-island/shared";
import { config } from "./config.js";
import type { Db } from "./db.js";
import { listBooks, setBookCover } from "./store.js";

const COVER_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

export function coverDir(): string {
  return path.join(config.root, "data", "covers");
}

export function openLibraryCoverUrl(isbn: string): string {
  const digits = isbn.replace(/[^0-9Xx]/g, "");
  if (digits.length < 10) {
    throw new AppError("Enter an ISBN with at least 10 digits to look up a cover.", "cover_isbn", 400);
  }
  return `https://covers.openlibrary.org/b/isbn/${digits}-L.jpg`;
}

export async function probeRemoteCover(url: string): Promise<string> {
  const parsed = parseCoverUrl(url);
  if (parsed.kind !== "remote") return parsed.value;
  try {
    const res = await fetch(parsed.value, { redirect: "follow" });
    if (!res.ok) {
      throw new AppError("That cover URL could not be loaded.", "cover_url", 400);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get("content-type") ?? "";
    if (type && !type.startsWith("image/") && buf.length < 2500) {
      throw new AppError("Open Library has no cover for that ISBN, or the URL is not an image.", "cover_url", 400);
    }
    return parsed.value;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("That cover URL could not be loaded.", "cover_url", 400);
  }
}

export function parseCoverUrl(raw: string): { kind: "remote" | "local"; value: string } {
  const url = raw.trim();
  if (!url) {
    throw new AppError("Paste an image URL, or upload a file.", "cover_url", 400);
  }
  if (url.startsWith("/api/books/") && url.includes("/cover-image")) {
    return { kind: "local", value: url.split("?")[0] };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError("Cover URLs must start with http:// or https://.", "cover_url", 400);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AppError("Cover URLs must start with http:// or https://.", "cover_url", 400);
  }
  return { kind: "remote", value: parsed.toString() };
}

function imageExtension(buf: Buffer, contentType: string): string | null {
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (COVER_TYPES[type]) return COVER_TYPES[type];
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8) return ".jpg";
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return ".png";
  if (buf.length >= 3 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return ".gif";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    return ".webp";
  }
  return null;
}

/** Download a remote cover and keep the bytes on disk. */
export async function saveRemoteCover(
  bookId: string,
  url: string,
): Promise<{ coverUrl: string; coverFile: string }> {
  const parsed = parseCoverUrl(url);
  if (parsed.kind !== "remote") {
    throw new AppError("That cover is already stored on this Mac.", "cover_url", 400);
  }
  let res: Response;
  try {
    res = await fetch(parsed.value, {
      redirect: "follow",
      headers: { "User-Agent": "ProgressIsland/0.1 (local cover cache)" },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new AppError("That cover URL could not be loaded.", "cover_url", 400);
  }
  if (!res.ok) throw new AppError("That cover URL could not be loaded.", "cover_url", 400);
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = imageExtension(buf, res.headers.get("content-type") ?? "");
  if (!ext || buf.length < 800) {
    throw new AppError("Open Library has no cover for that ISBN, or the URL is not an image.", "cover_url", 400);
  }
  if (buf.byteLength > 2 * 1024 * 1024) {
    throw new AppError("Cover images must be 2 MB or smaller.", "cover_file", 400);
  }
  const dir = coverDir();
  fs.mkdirSync(dir, { recursive: true });
  removeCoverFiles(bookId);
  const coverFile = `${bookId}${ext}`;
  fs.writeFileSync(path.join(dir, coverFile), buf);
  return { coverUrl: `/api/books/${bookId}/cover-image`, coverFile };
}

export function saveUploadedCover(
  bookId: string,
  file: { buffer: Buffer; mimetype: string },
): { coverUrl: string; coverFile: string } {
  const ext = COVER_TYPES[file.mimetype];
  if (!ext) {
    throw new AppError("Use a JPEG, PNG, WebP, or GIF image.", "cover_file", 400);
  }
  if (file.buffer.byteLength > 2 * 1024 * 1024) {
    throw new AppError("Cover images must be 2 MB or smaller.", "cover_file", 400);
  }
  const dir = coverDir();
  fs.mkdirSync(dir, { recursive: true });
  removeCoverFiles(bookId);
  const coverFile = `${bookId}${ext}`;
  fs.writeFileSync(path.join(dir, coverFile), file.buffer);
  return { coverUrl: `/api/books/${bookId}/cover-image`, coverFile };
}

export function coverFilePath(coverFile: string): string {
  const dir = coverDir();
  const base = path.basename(coverFile);
  const target = path.resolve(dir, base);
  if (!target.startsWith(`${dir}${path.sep}`)) {
    throw new AppError("Cover file is not available.", "cover_file", 404);
  }
  return target;
}

export function removeCoverFiles(bookId: string): void {
  const dir = coverDir();
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith(bookId)) fs.rmSync(path.join(dir, name), { force: true });
  }
}

/** Copy http(s) covers onto disk so the library still shows them offline. */
export async function cacheRemoteCovers(db: Db): Promise<number> {
  const pending = listBooks(db).filter((book) => (book.identifiers.coverUrl ?? "").startsWith("http"));
  let stored = 0;
  for (const book of pending) {
    const url = book.identifiers.coverUrl;
    if (!url) continue;
    try {
      const saved = await saveRemoteCover(book.id, url);
      setBookCover(db, book.id, saved.coverUrl, { coverFile: saved.coverFile });
      stored += 1;
    } catch {
      console.log(`Left the cover online for "${book.title}".`);
    }
  }
  return stored;
}

export function contentTypeForCover(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}
