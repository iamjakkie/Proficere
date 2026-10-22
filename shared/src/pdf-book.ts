import { titleGroundedInSource } from "./grounding.js";
import { overlayPrintedPages } from "./outline.js";
import type { OutlineChapter } from "./schemas.js";

export function titleFromFilename(filename: string): string {
  const base = filename.replace(/^.*[/\\]/, "").replace(/\.pdf$/i, "");
  const spaced = base.replace(/[_]+/g, " ").replace(/-/g, " ").replace(/\s+/g, " ").trim();
  return spaced || "Untitled book";
}

export function titleIsPlaceholder(title: string, filename: string): boolean {
  const trimmed = title.trim();
  if (!trimmed || /^untitled book$/i.test(trimmed)) return true;
  return trimmed.toLowerCase() === titleFromFilename(filename).toLowerCase();
}

/** Pick a title and chapter list that appear in the PDF text. Bookmark lists win when the file has one. */
export function chooseImportedBook(input: {
  filename: string;
  sourceText: string;
  localOutline: OutlineChapter[];
  ai: { title?: string | null; author?: string | null; chapters?: OutlineChapter[] } | null;
}): { title: string; author: string | null; outline: OutlineChapter[]; titleFromFile: boolean } {
  const aiTitle = input.ai?.title?.trim() ?? "";
  const title = aiTitle && titleGroundedInSource(aiTitle, input.sourceText) ? aiTitle : "";
  const authorRaw = input.ai?.author?.trim() ?? "";
  const author = authorRaw && titleGroundedInSource(authorRaw, input.sourceText) ? authorRaw : null;
  const aiChapters = (input.ai?.chapters ?? []).filter((chapter) => titleGroundedInSource(chapter.title, input.sourceText));
  const outline =
    input.localOutline.length >= 2
      ? input.localOutline
      : aiChapters.length
        ? overlayPrintedPages(aiChapters, input.localOutline)
        : input.localOutline;
  return {
    title: title || titleFromFilename(input.filename),
    author,
    outline,
    titleFromFile: !title,
  };
}
